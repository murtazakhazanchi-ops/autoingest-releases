'use strict';

/**
 * exifService.js — Post-import EXIF/XMP/IPTC metadata writer.
 *
 * Writes attribution and descriptive tags to every successfully-copied file
 * after an import transaction. Runs behind a bounded queue (maxConcurrency: 2)
 * so it never delays the import response.
 *
 * Metadata context must come from event.json + successful import results
 * (diskComponents, hijriDate). Never from transient renderer UI state.
 *
 * File handling:
 *   - RAW files  → write to .xmp sidecar placed next to the destination RAW.
 *                  Sidecar is created only if the destination RAW exists.
 *   - Images     → write directly (-overwrite_original).
 *   - Videos     → skipped entirely. Logged as "video metadata disabled".
 *                  Skipped files are NOT counted as failures.
 *
 * Tag schema — RAW XMP sidecar (XMP tags only; IPTC/EXIF don't apply to .xmp files):
 *   XMP-dc:Creator                    = [photographer]
 *   XMP-dc:Rights                     = © Aljamea-tus-Saifiyah
 *   XMP-dc:Subject                    = [keywords — see _buildKeywords]
 *   XMP-xmp:CreatorTool               = AutoIngest
 *   XMP-xmpRights:Marked              = True
 *   XMP-iptcCore:Location             = location (sublocation)
 *   XMP-photoshop:City                = city
 *   XMP-photoshop:Country             = country
 *   XMP-ajs:HijriDate                 = hijriDate  (only when present)
 *
 * Tag schema — images (JPEG/TIFF/PNG — all of the above PLUS):
 *   EXIF:Artist                       = photographer
 *   IPTC:By-line                      = photographer
 *   IPTC:CopyrightNotice              = © Aljamea-tus-Saifiyah
 *   IPTC:Credit                       = Aljamea-tus-Saifiyah
 *   IPTC:Sub-location                 = location
 *   IPTC:City                         = city
 *   IPTC:Country-PrimaryLocationName  = country
 *   IPTC:Keywords                     = [keywords]
 *
 * XMP-dc:Subject is written to all targets (sidecar + image). IPTC:Keywords is
 * written to images only. ExifTool silently drops IPTC:* when writing to .xmp
 * files because standalone XMP has no IPTC binary segment.
 *
 * Keyword rules (never collName, eventName, photographer):
 *   Always: location, city, country (when present on the resolved component)
 *   Component type tags (single-component): included only when comma-split
 *     produces exactly 1 tag; 0 or 2+ → suppressed (ambiguous).
 *   Component type tags (multi-component): all tags for that sub-event included;
 *     routing to the sub-event already disambiguates the intent.
 *   All keywords deduplicated (case-insensitive).
 *
 * Videos written to IPTC/EXIF: none.
 * DateTimeOriginal: never written. Camera date fields are never modified.
 */

const path   = require('path');
const fsp    = require('fs').promises;
const config = require('../config/app.config');
const { log } = require('../services/logger');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const queueStore = require('./metadataQueueStore');

// Absolute path to the ExifTool config file that declares the XMP-ajs namespace.
// When packaged, __dirname resolves inside app.asar which OS-level child processes
// cannot access. electron-builder's asarUnpack places the file at the real path
// app.asar.unpacked/main/exiftool-config.pl — use that path when packaged.
const EXIFTOOL_CONFIG = __dirname.includes('app.asar')
  ? path.join(__dirname.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'), 'exiftool-config.pl')
  : path.join(__dirname, 'exiftool-config.pl');

// ── ExifTool singleton ────────────────────────────────────────────────────────

let _ExifTool = null;

function _getExifTool() {
  if (!_ExifTool) {
    const { ExifTool } = require('exiftool-vendored');
    // -config must be the very first argument ExifTool sees at spawn time.
    // exiftool-vendored starts one persistent ExifTool process per slot and
    // pipes commands to its stdin. Any -config passed inside per-write args
    // arrives too late (process is already running) and is silently ignored.
    // We must inject -config before the required batch-mode flags
    // (-stay_open True -@ -) so the custom XMP-ajs namespace is registered
    // at startup.
    _ExifTool = new ExifTool({
      // 4 persistent processes let metadata reads/writes overlap NAS I/O latency
      // (each read is a network round-trip). The metadata-sync classify scan issues
      // reads with matching bounded concurrency to keep these busy without flooding.
      maxProcs: 4,
      taskTimeoutMillis: 30_000,
      exiftoolArgs: ['-config', EXIFTOOL_CONFIG, '-stay_open', 'True', '-@', '-'],
    });
  }
  return _ExifTool;
}

// Tears down a dead cluster and clears the singleton so _getExifTool() spawns
// a fresh instance on the next call. Used when BatchCluster reports it has ended
// (e.g. after an ExifTool process crash or a previous error that terminated the pool).
function _resetExifTool() {
  const old = _ExifTool;
  _ExifTool = null;
  if (old) old.end().catch(() => {});
}

// ── Extension sets ────────────────────────────────────────────────────────────

const RAW_EXTENSIONS = new Set(config.RAW_EXTENSIONS);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mts', '.m2ts', '.wmv', '.flv',
]);

// ── Batch state ───────────────────────────────────────────────────────────────

/**
 * `status` is the original three-way write outcome (unchanged, for backward
 * compatibility with existing UI consumers). `classification` is the new,
 * finer-grained result the read-back verification produces — this is what
 * distinguishes a write that actually landed the expected fields from one that
 * merely didn't throw (the exact QMZ blind spot this fix closes).
 * @typedef {{
 *   status:         'pending'|'writing'|'done'|'skipped'|'error',
 *   classification: 'complete'|'partial'|'failed'|'excluded'|'ambiguous'|null,
 *   src:     string,
 *   dest:    string,
 *   sidecar: string|null,
 *   error:   string|null,
 * }} FileStatus
 *
 * @typedef {{
 *   total:     number,
 *   done:      number,
 *   skipped:   number,
 *   failed:    number,
 *   partial:   number,
 *   ambiguous: number,
 *   excluded:  number,
 *   files:     FileStatus[],
 * }} BatchStatus
 */

/** @type {Map<string, BatchStatus>} */
const _batches = new Map();

// ── Queue ─────────────────────────────────────────────────────────────────────

const MAX_CONCURRENCY = 2;
let _running = 0;
const _queue = [];

function _enqueue(fn) {
  _queue.push(fn);
  _drain();
}

function _drain() {
  while (_running < MAX_CONCURRENCY && _queue.length > 0) {
    const job = _queue.shift();
    _running++;
    job().finally(() => { _running--; _drain(); });
  }
}

// ── Tag builder ───────────────────────────────────────────────────────────────
// Decision logic (which component/keywords/photographer apply) lives entirely in
// metadataExpectationService — this only turns an already-resolved expectation
// into an ExifTool tag map. See that module for the evidence hierarchy.

/**
 * @param {ReturnType<import('../services/metadataExpectationService').resolveExpectedMetadata>} expectation
 * @param {boolean} isRaw
 * @returns {object}
 */
function _buildTags(expectation, isRaw) {
  const { photographer, component, keywords, hijriDate, eventDescription, copyright } = expectation;
  const location = component?.location || '';
  const city     = component?.city     || '';
  const country  = component?.country  || '';

  // XMP tags — valid for both .xmp sidecars and embedded XMP in images.
  const tags = {
    'XMP-dc:Creator':           photographer ? [photographer] : [],
    'XMP-dc:Rights':            copyright,
    'XMP-dc:Subject':           keywords,
    'XMP-dc:Description':       eventDescription || '',
    'XMP-xmp:CreatorTool':      'AutoIngest',
    'XMP-xmpRights:Marked':     'True',
    'XMP-iptcCore:Location':    location,
    'XMP-photoshop:City':        city,
    'XMP-photoshop:Country':     country,
  };

  if (hijriDate) tags['XMP-ajs:HijriDate'] = hijriDate;

  if (!isRaw) {
    // IPTC/EXIF tags for direct image writes. Not sent to .xmp sidecar files.
    Object.assign(tags, {
      'EXIF:Artist':                       photographer || '',
      'IPTC:By-line':                      photographer || '',
      'IPTC:CopyrightNotice':              copyright,
      'IPTC:Credit':                       'Aljamea-tus-Saifiyah',
      'IPTC:Caption-Abstract':             eventDescription || '',
      'IPTC:Sub-location':                 location,
      'IPTC:City':                         city,
      'IPTC:Country-PrimaryLocationName':  country,
      'IPTC:Keywords':                     keywords,
    });
  }

  return tags;
}

// ── File writer ───────────────────────────────────────────────────────────────

/**
 * Writes tags to a single file or its XMP sidecar (for RAW files).
 *
 * RAW: verifies destination file exists before creating/writing the sidecar.
 *      Never modifies the RAW file directly.
 * Image: writes in place with -overwrite_original.
 *
 * @param {string}  filePath  Absolute dest path.
 * @param {object}  tags      Tag map from _buildTags.
 * @param {boolean} isRaw
 * @returns {Promise<string|null>}  Sidecar path if created, else null.
 */
async function _writeMetadata(filePath, tags, isRaw) {
  const et = _getExifTool();
  // -config is now a startup arg (exiftoolArgs in constructor). Only per-write flags here.
  const writeArgs = ['-overwrite_original'];

  if (isRaw) {
    // Guard: do not create sidecar unless the destination RAW is on disk.
    try { await fsp.access(filePath); } catch {
      throw new Error(`Destination RAW not found, skipping sidecar: ${filePath}`);
    }

    const ext     = path.extname(filePath);
    const sidecar = filePath.slice(0, filePath.length - ext.length) + '.xmp';

    // Create a minimal XMP stub if the sidecar doesn't exist yet.
    let sidecarExists = false;
    try { await fsp.access(sidecar); sidecarExists = true; } catch { /* not found */ }
    if (!sidecarExists) {
      const stub =
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
        '</x:xmpmeta>\n' +
        '<?xpacket end="w"?>\n';
      await fsp.writeFile(sidecar, stub, 'utf8');
    }

    await et.write(sidecar, tags, writeArgs);
    return sidecar;
  }

  await et.write(filePath, tags, writeArgs);
  return null;
}

// ── Evidence adapter ──────────────────────────────────────────────────────────
// Translates exifService's existing per-batch context (already the evidence the
// resolver needs) into the resolver's evidence shape. This is a pure translation,
// not decision logic — which shape to use is signaled by the presence of
// `diskComponents` (standard/reapply) vs `component` (QMZ) on the context object.

function _buildEvidence(file, context) {
  const photographer      = file.photographer != null ? file.photographer : (context.photographer || '');
  const hijriDate          = context.hijriDate || null;
  const eventDescription   = context.eventDescription || null;

  if (Array.isArray(context.diskComponents)) {
    return { filePath: file.src, photographer, hijriDate, eventDescription, groups: context.groups, diskComponents: context.diskComponents };
  }
  return {
    filePath: file.src, photographer, hijriDate, eventDescription,
    qmzComponent: context.component ?? null, qmzExplicitTags: context.explicitTags,
  };
}

// ── Read-back comparator ──────────────────────────────────────────────────────
// Normalizes both sides before comparing — exiftool-vendored collapses single-item
// List tags to a plain string on read, so a written array and a read-back string
// must not be treated as a mismatch.

function _norm(v) {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map(x => String(x).trim()).filter(Boolean);
}

function _arraysEqualUnordered(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Compares the actually-written tags against the resolved expectation.
 * @returns {{ complete: boolean, mismatches: string[] }}
 */
function _compareReadback(actual, expectation, isRaw) {
  const mismatches = [];
  const check = (field, expected, actualVal, ordered) => {
    const e = _norm(expected), a = _norm(actualVal);
    const match = ordered ? (e.length === a.length && e.every((v, i) => v === a[i])) : _arraysEqualUnordered(e, a);
    if (!match) mismatches.push(field);
  };

  check('photographer', expectation.photographer, actual.Creator ?? actual['XMP-dc:Creator'], false);
  check('copyright',    expectation.copyright,     actual.Rights  ?? actual['XMP-dc:Rights'],  false);
  check('keywords',     expectation.keywords,      actual.Subject ?? actual['XMP-dc:Subject'], false);
  check('description',  expectation.eventDescription || '', actual.Description ?? actual['XMP-dc:Description'], false);
  check('location',     expectation.component?.location || '', actual.Location ?? actual['XMP-iptcCore:Location'], false);
  check('city',         expectation.component?.city     || '', actual.City     ?? actual['XMP-photoshop:City'],   false);
  check('country',      expectation.component?.country  || '', actual.Country  ?? actual['XMP-photoshop:Country'], false);
  if (expectation.hijriDate) {
    check('hijriDate', expectation.hijriDate, actual.HijriDate ?? actual['XMP-ajs:HijriDate'], false);
  }
  if (!isRaw) {
    check('copyright(iptc)', expectation.copyright, actual.CopyrightNotice ?? actual['IPTC:CopyrightNotice'], false);
    check('keywords(iptc)',  expectation.keywords,  actual.Keywords ?? actual['IPTC:Keywords'], false);
  }

  return { complete: mismatches.length === 0, mismatches };
}

// ── Durable manifest + journal wiring ─────────────────────────────────────────
// Frozen-snapshot principle (plan §6): every file's expectation is resolved once,
// up front, and recorded in the batch manifest before any write happens. _processFile
// below always writes the frozen expectation it's handed — it never re-resolves.
// Recovery (metadataQueueRecovery.js) may re-resolve as a safety comparison only.

function _classify(file) {
  const ext = path.extname(file.dest).toLowerCase();
  return { isRaw: RAW_EXTENSIONS.has(ext), isVideo: VIDEO_EXTENSIONS.has(ext) };
}

function _resolveForFile(file, context) {
  const { isRaw, isVideo } = _classify(file);
  if (isVideo) return { isRaw, isVideo, evidence: null, expectation: null };
  const evidence = _buildEvidence(file, context);
  const expectation = resolveExpectedMetadata(evidence);
  return { isRaw, isVideo, evidence, expectation };
}

async function _journal(batchId, dest, status, extra = {}) {
  try {
    await queueStore.appendJournalEntry(batchId, { dest, status, ...extra });
  } catch (err) {
    log(`[exifService] journal append failed for batch ${batchId} (${dest}): ${err.message}`);
  }
}

/**
 * Writes the batch manifest once, before any file is processed. Best-effort: a
 * manifest write failure is logged but never blocks metadata writing itself —
 * durability is a safety net, not a precondition for the primary write path.
 */
async function _writeBatchManifest(batchId, resolved, context) {
  try {
    const settings = require('../services/settings');
    const mainArchiveRoot = settings.getMainArchiveRoot ? settings.getMainArchiveRoot() : null;
    const archiveRootIdentity = mainArchiveRoot
      ? await queueStore.readRootIdentity(path.join(mainArchiveRoot, '.autoingest', 'root', 'archive-root.json'))
      : null;

    const eventDir = context.eventJsonPath ? path.dirname(context.eventJsonPath) : null;
    const files = await Promise.all(resolved.map(async ({ file, isRaw, isVideo, evidence, expectation }) => {
      let size = null;
      try { size = (await fsp.stat(file.dest)).size; } catch { /* not yet on disk / unreadable — non-fatal */ }
      return {
        src: file.src, dest: file.dest,
        relDestPath: eventDir ? path.relative(eventDir, file.dest) : null,
        size, isRaw, isVideo, evidence, expectation,
      };
    }));

    await queueStore.writeManifestOnce(batchId, {
      schemaVersion: 1,
      batchId,
      metadataContractVersion: require('../services/metadataExpectationService').METADATA_CONTRACT_VERSION,
      resolverVersion: require('../services/metadataExpectationService').RESOLVER_VERSION,
      archiveRootIdentity,
      eventJsonPath: context.eventJsonPath || null,
      queuedAt: new Date().toISOString(),
      files,
    });
  } catch (err) {
    log(`[exifService] manifest write failed for batch ${batchId}: ${err.message}`);
  }
}

// ── Shared per-file processor ─────────────────────────────────────────────────

/**
 * Writes + read-back-verifies a single already-resolved expectation. Never resolves
 * on its own — callers (normal processing, retry, resume) all hand it a frozen
 * expectation so a resumed/retried write is guaranteed to target the same value
 * the original queue decision recorded.
 */
async function _writeAndVerify(file, status, expectation, isRaw) {
  const tags    = _buildTags(expectation, isRaw);
  const sidecar = await _writeMetadata(file.dest, tags, isRaw);
  status.sidecar = sidecar;

  // Always-on, bounded read-back — only the fields just written, not a full dump.
  // For RAW files this MUST read the sidecar path _writeMetadata returned, never
  // the RAW file's own embedded tags (exiftool-vendored reads embedded RAW tags
  // when pointed at the RAW path directly — proven in test/rawXmpReadback.test.js).
  const verifyPath = sidecar || file.dest;
  const et  = _getExifTool();
  const rb  = await et.read(verifyPath);
  return _compareReadback(rb, expectation, isRaw);
}

/**
 * Processes a single file entry: skip videos, write the frozen expectation
 * (resolved up front — see _resolveForFile/_writeBatchManifest), and verify.
 * Updates the FileStatus object in place, bumps batch counters, and journals
 * every status transition for durability.
 *
 * @param {string} batchId
 * @param {{ src:string, dest:string, photographer?:string|null }} file
 * @param {FileStatus} status
 * @param {BatchStatus} batch
 * @param {{isRaw:boolean, isVideo:boolean, expectation:object|null}} resolved Frozen
 *   per-file resolution from _resolveForFile, computed once at applyBatch time.
 */
async function _processFile(batchId, file, status, batch, resolved) {
  const { isRaw, isVideo, expectation } = resolved;

  if (isVideo) {
    status.status = 'skipped';
    status.classification = 'excluded';
    batch.skipped++;
    batch.excluded = (batch.excluded || 0) + 1;
    log(`[exifService] Skipped (video metadata disabled): ${path.basename(file.dest)}`);
    await _journal(batchId, file.dest, 'excluded', { classification: 'excluded' });
    return;
  }

  if (expectation.status === 'ambiguous') {
    status.status = 'skipped';
    status.classification = 'ambiguous';
    status.error = expectation.ambiguityReason;
    batch.skipped++;
    batch.ambiguous = (batch.ambiguous || 0) + 1;
    log(`[exifService] Ambiguous — not written: ${path.basename(file.dest)} (${expectation.ambiguityReason})`);
    await _journal(batchId, file.dest, 'ambiguous', { classification: 'ambiguous', error: expectation.ambiguityReason });
    return;
  }

  status.status = 'writing';
  await _journal(batchId, file.dest, 'writing');

  try {
    // Validate before writing: a resolved expectation with no photographer at all
    // is still written (photographer may legitimately be unknown for some sources),
    // but is flagged for the read-back classification below rather than blocked —
    // the write must still happen so Copyright/Description/Keywords land.
    const cmp = await _writeAndVerify(file, status, expectation, isRaw);

    if (cmp.complete) {
      status.status = 'done';
      status.classification = 'complete';
      batch.done++;
      await _journal(batchId, file.dest, 'complete', { classification: 'complete' });
    } else {
      status.status = 'done';
      status.classification = 'partial';
      status.error  = `Read-back mismatch: ${cmp.mismatches.join(', ')}`;
      batch.done++;
      batch.partial = (batch.partial || 0) + 1;
      log(`[exifService] Partial (read-back mismatch): ${path.basename(file.dest)} — ${cmp.mismatches.join(', ')}`);
      await _journal(batchId, file.dest, 'partial', { classification: 'partial', error: status.error });
    }
  } catch (err) {
    if (err.message && err.message.includes('BatchCluster has ended')) {
      _resetExifTool();
    }
    status.status = 'error';
    status.classification = 'failed';
    status.error  = err.message;
    batch.failed++;
    log(`[exifService] Write failed: ${file.dest} | ${err.message}`);
    await _journal(batchId, file.dest, 'failed', { classification: 'failed', error: err.message });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Applies metadata to all files in a batch. Fire-and-forget; returns immediately.
 * Progress is emitted via emitFn after each file and at batch start/complete.
 *
 * @param {string} batchId
 * @param {Array<{src:string, dest:string}>} copiedFiles
 * @param {{
 *   photographer:   string,
 *   eventName:      string,
 *   collName:       string,
 *   hijriDate:      string|null,
 *   groups:         object[],
 *   diskComponents: object[],
 * }} context
 * @param {((progress:object) => void)|null} emitFn
 */
function applyBatch(batchId, copiedFiles, context, emitFn) {
  if (!Array.isArray(copiedFiles) || copiedFiles.length === 0) return;

  const fileStatuses = copiedFiles.map(f => ({
    // photographer is optional per-file — set by reapply to support multi-photographer events.
    // When null, _processFile falls back to context.photographer.
    status: 'pending', classification: null, src: f.src, dest: f.dest, photographer: f.photographer ?? null, sidecar: null, error: null,
  }));

  // Frozen-snapshot resolution (plan §6): every file's expectation is resolved once,
  // right here, before any write or manifest persistence — _processFile/_writeAndVerify
  // always consume this frozen value, never re-resolve.
  const resolved = copiedFiles.map(f => _resolveForFile(f, context));

  // Store context alongside batch so retries re-use the event.json-derived context,
  // never a stale renderer-side snapshot.
  const batch = {
    total: copiedFiles.length, done: 0, skipped: 0, failed: 0,
    partial: 0, ambiguous: 0, excluded: 0,
    files: fileStatuses, _context: context, _resolved: resolved,
  };
  _batches.set(batchId, batch);

  if (emitFn) emitFn({ batchId, event: 'batch_start', total: batch.total });

  // Preflight: verify ExifTool responds before occupying queue slots with file jobs.
  // A broken binary causes each et.write() to hang for taskTimeoutMillis (30 s) per file,
  // making metadata appear stuck at 0% for the full batch duration.
  //
  // If the cluster has already ended (e.g. from a previous batch error), reset it and
  // retry once with a fresh instance before failing the entire batch.
  //
  // The manifest write is awaited as the FIRST step of this same queued job — never
  // fired unawaited alongside it — because _enqueue runs up to MAX_CONCURRENCY jobs
  // concurrently, not strictly FIFO. Only after the manifest is durably on disk do we
  // even check ExifTool, and file jobs are only ever scheduled from this function's own
  // continuation below — so no file's journal entry can exist before its batch's
  // manifest does, closing the race where a crash mid-batch could leave completed work
  // invisible to both resume and the durable-counts system (no manifest → not found by
  // listActiveBatchIds → never revisited).
  _enqueue(async () => {
    await _writeBatchManifest(batchId, resolved.map((r, i) => ({ file: copiedFiles[i], ...r })), context);

    let preflightErr = null;
    try {
      await _getExifTool().version();
    } catch (err) {
      if (err.message && err.message.includes('BatchCluster has ended')) {
        log(`[exifService] BatchCluster ended — resetting ExifTool and retrying preflight for batch ${batchId}`);
        _resetExifTool();
        try {
          await _getExifTool().version();
        } catch (retryErr) {
          preflightErr = retryErr;
        }
      } else {
        preflightErr = err;
      }
    }

    if (preflightErr) {
      log(`[exifService] ExifTool preflight failed for batch ${batchId}: ${preflightErr.message}`);
      for (const status of batch.files) {
        status.status = 'error';
        status.classification = 'failed';
        status.error  = `ExifTool unavailable: ${preflightErr.message}`;
        await _journal(batchId, status.dest, 'failed', { classification: 'failed', error: status.error });
      }
      batch.failed = batch.total;
      if (emitFn) {
        emitFn({
          batchId, event: 'batch_complete',
          done: 0, skipped: 0, failed: batch.total, total: batch.total,
          partial: 0, ambiguous: 0, excluded: 0,
        });
        emitFn({
          batchId, event: 'batch_error',
          failed: batch.total,
          errors: batch.files.map(f => ({ file: path.basename(f.dest), error: f.error })),
        });
      }
      return;
    }

    // ExifTool is responsive — enqueue individual file jobs.
    copiedFiles.forEach((file, idx) => {
      _enqueue(async () => {
        const status = batch.files[idx];
        await _processFile(batchId, file, status, batch, resolved[idx]);

        if (emitFn) {
          emitFn({
            batchId, event: 'file_done',
            index: idx, dest: file.dest, status: status.status,
            done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total,
          });
        }

        if (batch.done + batch.skipped + batch.failed === batch.total) {
          if (emitFn) {
            emitFn({
              batchId, event: 'batch_complete',
              done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total,
              partial: batch.partial, ambiguous: batch.ambiguous, excluded: batch.excluded,
            });
          }
          log(`[exifService] Batch ${batchId} complete — ${batch.done} ok, ${batch.skipped} skipped, ${batch.failed} failed`);

          if (batch.failed > 0) {
            const failedFiles = batch.files.filter(f => f.status === 'error');
            const preview     = failedFiles.slice(0, 10);
            const overflow    = failedFiles.length - preview.length;
            console.error(`[exifService] ${batch.failed} metadata write(s) failed in batch ${batchId}:`);
            for (const f of preview) {
              console.error(`  ✗ ${path.basename(f.dest)}: ${f.error}`);
            }
            if (overflow > 0) {
              console.error(`  ...and ${overflow} more`);
            }
            if (emitFn) {
              emitFn({
                batchId, event: 'batch_error',
                failed: batch.failed,
                errors: failedFiles.map(f => ({ file: path.basename(f.dest), error: f.error })),
              });
            }
          }
        }
      });
    });
  });
}

/**
 * Retries all files in a batch currently in 'error' state.
 * Uses the event.json-derived context stored during applyBatch — never the
 * caller-provided context — to preserve source-of-truth guarantees.
 *
 * @param {string} batchId
 * @param {((progress:object) => void)|null} emitFn
 */
function retryFailed(batchId, emitFn) {
  const batch = _batches.get(batchId);
  if (!batch) {
    log(`[exifService] retryFailed: unknown batchId ${batchId}`);
    return;
  }

  const toRetry = batch.files
    .map((f, idx) => ({ idx, f }))
    .filter(({ f }) => f.status === 'error');

  if (toRetry.length === 0) return;

  for (const { f } of toRetry) {
    batch.failed--;
    f.status = 'pending';
    f.classification = null;
    f.error  = null;
  }

  let remaining = toRetry.length;

  for (const { idx } of toRetry) {
    const file   = batch.files[idx];
    const status = file;

    _enqueue(async () => {
      const fileArg = { src: file.src, dest: file.dest, photographer: file.photographer ?? null };
      await _processFile(batchId, fileArg, status, batch, batch._resolved[idx]);
      remaining--;

      if (emitFn) {
        emitFn({
          batchId, event: 'file_done',
          index: idx, dest: file.dest, status: status.status,
          done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total,
        });
      }

      // Retry has its own completion signal — without this, the renderer's
      // retry-pending flag never clears (it only ever watched batch_complete/
      // batch_error, which applyBatch's original run already fired once).
      if (remaining === 0) {
        const retriedIdx = toRetry.map(t => t.idx);
        const stillFailed = retriedIdx.filter(i => batch.files[i].status === 'error');
        if (emitFn) {
          emitFn({
            batchId, event: 'batch_complete',
            done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total,
            partial: batch.partial, ambiguous: batch.ambiguous, excluded: batch.excluded,
          });
          if (stillFailed.length > 0) {
            emitFn({
              batchId, event: 'batch_error',
              failed: stillFailed.length,
              errors: stillFailed.map(i => ({ file: path.basename(batch.files[i].dest), error: batch.files[i].error })),
            });
          }
        }
      }
    });
  }
}

/**
 * Returns the current status of a batch, or null if not found.
 * @param {string} batchId
 * @returns {BatchStatus|null}
 */
function getBatchStatus(batchId) {
  return _batches.get(batchId) || null;
}

/**
 * Gracefully shuts down the ExifTool process pool. Call during app quit.
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (_ExifTool) {
    await _ExifTool.end();
    _ExifTool = null;
  }
}

/**
 * Reads all ExifTool tags from a file or XMP sidecar.
 * Reuses the existing ExifTool process pool — no extra processes spawned.
 * @param {string} filePath
 * @returns {Promise<object>}
 */
function readFileTags(filePath) {
  return _getExifTool().read(filePath);
}

/**
 * Resume-only entry point: writes a single previously-frozen expectation (from a
 * manifest recovered by metadataQueueRecovery.js) without re-resolving it. The
 * caller is responsible for the safety comparison against a fresh resolve (plan
 * §6) — by the time this is called, that decision has already been made.
 * @param {string} batchId The original batch's id (journal entries append to it).
 * @param {{dest:string, isRaw:boolean, expectation:object}} fileEntry
 * @returns {Promise<{classification:'complete'|'partial'|'failed', error?:string}>}
 */
async function resumeFrozenFile(batchId, fileEntry) {
  const { dest, isRaw, expectation } = fileEntry;
  await _journal(batchId, dest, 'writing');
  try {
    const cmp = await _writeAndVerify({ dest }, { sidecar: null }, expectation, isRaw);
    if (cmp.complete) {
      await _journal(batchId, dest, 'complete', { classification: 'complete' });
      return { classification: 'complete' };
    }
    const error = `Read-back mismatch: ${cmp.mismatches.join(', ')}`;
    await _journal(batchId, dest, 'partial', { classification: 'partial', error });
    return { classification: 'partial', error };
  } catch (err) {
    if (err.message && err.message.includes('BatchCluster has ended')) _resetExifTool();
    await _journal(batchId, dest, 'failed', { classification: 'failed', error: err.message });
    return { classification: 'failed', error: err.message };
  }
}

/**
 * Read-only classification + sidecar-path resolution, shared with verification
 * workflows (Transfer Import / same-size-skip) so they never re-derive the RAW/video
 * split or the sidecar-path convention independently of the apply engine.
 * @param {string} destPath
 * @returns {{isRaw:boolean, isVideo:boolean, verifyPath:string}} verifyPath is the
 *   sidecar path for RAW files (whether or not it exists yet) or destPath itself.
 */
function classifyForVerification(destPath) {
  const { isRaw, isVideo } = _classify({ dest: destPath });
  if (!isRaw) return { isRaw, isVideo, verifyPath: destPath };
  const ext = path.extname(destPath);
  return { isRaw, isVideo, verifyPath: destPath.slice(0, destPath.length - ext.length) + '.xmp' };
}

module.exports = {
  applyBatch, retryFailed, getBatchStatus, shutdown, readFileTags, resumeFrozenFile,
  classifyForVerification, compareReadback: _compareReadback, buildEvidence: _buildEvidence,
  RAW_EXTENSIONS, VIDEO_EXTENSIONS,
  // Test-only: exposes the tag builder so test/fieldSpecsConsistency.test.js can
  // behaviorally verify it stays in sync with the resolver's field set (closure item
  // #10's interim guardrail) without hand-copying a duplicate field list into the
  // test itself. Not part of the module's real public API — no other caller should
  // use this directly; go through applyBatch/resumeFrozenFile instead.
  _buildTags,
};
