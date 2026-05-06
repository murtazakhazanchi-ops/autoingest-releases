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

const path  = require('path');
const fsp   = require('fs').promises;
const { log } = require('../services/logger');

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
      maxProcs: 2,
      taskTimeoutMillis: 30_000,
      exiftoolArgs: ['-config', EXIFTOOL_CONFIG, '-stay_open', 'True', '-@', '-'],
    });
  }
  return _ExifTool;
}

// ── Extension sets ────────────────────────────────────────────────────────────

const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.arw', '.nef', '.orf', '.rw2', '.raf', '.dng',
  '.pef', '.srw', '.x3f', '.iiq', '.3fr',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.mts', '.m2ts', '.wmv', '.flv',
]);

// ── Batch state ───────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   status:  'pending'|'writing'|'done'|'skipped'|'error',
 *   src:     string,
 *   dest:    string,
 *   sidecar: string|null,
 *   error:   string|null,
 * }} FileStatus
 *
 * @typedef {{
 *   total:   number,
 *   done:    number,
 *   skipped: number,
 *   failed:  number,
 *   files:   FileStatus[],
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

// ── Keyword builder ───────────────────────────────────────────────────────────

/**
 * Builds the deduplicated IPTC keyword array for a single file.
 *
 * Keyword contents (ONLY these — never collName, eventName, photographer):
 *  - location, city, country from the resolved component (always, when present)
 *  - Component type tags (from component.types[]), with comma-split rules:
 *
 *    Single-component event (isMulti = false):
 *      Join types[], split by comma, trim, filter. If exactly 1 tag → include.
 *      If 0 or 2+ tags → ambiguous, suppress all type keywords.
 *
 *    Multi-component event (isMulti = true):
 *      Files are already routed to a specific sub-event component. All of that
 *      component's comma-split tags are included (routing disambiguates).
 *
 *    Metadata grouping mode (explicitTags array provided):
 *      Uses exactly the provided tags. Empty array = no component keywords.
 *      Location/city/country are still included regardless.
 *
 * @param {{ component: object|null, isMulti: boolean, explicitTags?: string[] }} ctx
 * @returns {string[]}
 */
function _buildKeywords({ component, isMulti, explicitTags }) {
  const kw = [];

  if (component) {
    const location = (typeof component.location === 'string' ? component.location : '') || '';
    const city     = (typeof component.city     === 'string' ? component.city     : '') || '';
    const country  = (typeof component.country  === 'string' ? component.country  : '') || '';

    // 1. Component type tag(s)
    if (Array.isArray(explicitTags)) {
      // Metadata grouping mode: use the group's assigned tags exactly.
      // Empty array means no component keywords (user chose "No component tag").
      kw.push(...explicitTags);
    } else {
      const typeArr = Array.isArray(component.types) ? component.types : [];
      const allTags = typeArr
        .join(',')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      if (isMulti) {
        // Multi-component: sub-event routing disambiguates — include all type tags.
        kw.push(...allTags);
      } else {
        // Single-component: include type tag only when comma-split gives exactly 1.
        if (allTags.length === 1) kw.push(allTags[0]);
        // 0 or 2+ → ambiguous, suppress.
      }
    }

    // 2. location  3. city  4. country — always included when present.
    if (location) kw.push(location);
    if (city)     kw.push(city);
    if (country)  kw.push(country);
  }

  const seen = new Set();
  return kw.filter(k => {
    const key = (k || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Component resolver ────────────────────────────────────────────────────────

/**
 * Returns the disk-format component for a given source file path.
 *
 * Context carries diskComponents from event.json (authoritative source of
 * truth). Matching for multi-component events uses comp.folderName, which is
 * the same value stored in group.subEventId.
 *
 * @param {string}   src
 * @param {object[]} groups         Array of { id, subEventId, files: string[] }
 * @param {object[]} diskComponents Disk-format components from event.json
 * @returns {object|null}
 */
function _resolveComponent(src, groups, diskComponents) {
  if (!Array.isArray(groups) || !Array.isArray(diskComponents)) return null;

  const srcNorm = path.normalize(src);
  for (const group of groups) {
    const files = Array.isArray(group.files) ? group.files : [];
    if (!files.some(f => path.normalize(f) === srcNorm)) continue;

    if (!group.subEventId) {
      return diskComponents[0] || null;
    }

    return diskComponents.find(c => c.folderName === group.subEventId) || null;
  }

  return null;
}

/**
 * Returns the raw group object for a given source file path, or null.
 * Used to detect metadata grouping assignments (group.metadataTags).
 *
 * @param {string}   src
 * @param {object[]} groups
 * @returns {object|null}
 */
function _resolveGroupForFile(src, groups) {
  if (!Array.isArray(groups)) return null;
  const srcNorm = path.normalize(src);
  for (const group of groups) {
    const files = Array.isArray(group.files) ? group.files : [];
    if (files.some(f => path.normalize(f) === srcNorm)) return group;
  }
  return null;
}

// ── Tag builder ───────────────────────────────────────────────────────────────

/**
 * Builds the complete tag object for a non-video file.
 *
 * XMP tags are always included — they are valid in both standalone .xmp sidecar
 * files and in the embedded XMP block of JPEG/TIFF/PNG files.
 *
 * IPTC/EXIF tags are added only for direct image writes (isRaw = false).
 * Standalone XMP sidecar files have no IPTC binary segment; ExifTool silently
 * drops IPTC:* writes to .xmp files, so sending them would leave keywords and
 * location fields missing from sidecars.
 *
 * @param {{ photographer:string, hijriDate:string|null, component:object|null, isMulti:boolean, isRaw:boolean, explicitTags?:string[] }} ctx
 * @returns {object}
 */
function _buildTags({ photographer, hijriDate, component, isMulti, isRaw, explicitTags }) {
  const location = component?.location || '';
  const city     = component?.city     || '';
  const country  = component?.country  || '';

  const keywords = _buildKeywords({ component, isMulti, explicitTags });

  // XMP tags — valid for both .xmp sidecars and embedded XMP in images.
  const tags = {
    'XMP-dc:Creator':           photographer ? [photographer] : [],
    'XMP-dc:Rights':            '© Aljamea-tus-Saifiyah',
    'XMP-dc:Subject':           keywords,
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
      'IPTC:CopyrightNotice':              '© Aljamea-tus-Saifiyah',
      'IPTC:Credit':                       'Aljamea-tus-Saifiyah',
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

// ── Shared per-file processor ─────────────────────────────────────────────────

/**
 * Processes a single file entry: skip videos, write metadata for images/RAW.
 * Updates the FileStatus object in place and bumps batch counters.
 *
 * @param {{ src:string, dest:string }} file
 * @param {FileStatus} status
 * @param {BatchStatus} batch
 * @param {{ photographer:string, hijriDate:string|null,
 *           groups:object[], diskComponents:object[] }} context
 */
async function _processFile(file, status, batch, context) {
  const ext     = path.extname(file.dest).toLowerCase();
  const isRaw   = RAW_EXTENSIONS.has(ext);
  const isVideo = VIDEO_EXTENSIONS.has(ext);

  if (isVideo) {
    status.status = 'skipped';
    batch.skipped++;
    log(`[exifService] Skipped (video metadata disabled): ${path.basename(file.dest)}`);
    return;
  }

  status.status = 'writing';

  try {
    const isMulti      = Array.isArray(context.diskComponents) && context.diskComponents.length > 1;
    let   component    = _resolveComponent(file.src, context.groups, context.diskComponents);

    // Defensive: every file must resolve to a group (and therefore a component) so that
    // location/city/country are always written. If a future change to group reconstruction,
    // metadataGroups format, or reapply logic breaks this invariant for a single-component
    // event, fall back to diskComponents[0] rather than silently writing no metadata.
    // Multi-component null is genuinely unresolvable and left as-is.
    if (!component && !isMulti && Array.isArray(context.diskComponents) && context.diskComponents.length > 0) {
      console.warn(`[exifService] No component resolved for ${path.basename(file.src)} — falling back to base component for location/city/country`);
      component = context.diskComponents[0];
    }

    // Per-file photographer takes precedence (set by reapplyEvent for multi-photographer events).
    const photographer = file.photographer != null ? file.photographer : (context.photographer || '');

    // Metadata grouping mode: if the resolved group carries an explicit metadataTags
    // array, pass it to _buildTags so it overrides the standard comma-split logic.
    // null/undefined metadataTags → fall through to existing keyword rules.
    const resolvedGroup = _resolveGroupForFile(file.src, context.groups);
    const explicitTags  = Array.isArray(resolvedGroup?.metadataTags)
      ? resolvedGroup.metadataTags
      : undefined;

    const tags         = _buildTags({
      photographer,
      hijriDate:    context.hijriDate    || null,
      component,
      isMulti,
      isRaw,
      explicitTags,
    });

    const sidecar = await _writeMetadata(file.dest, tags, isRaw);
    status.status  = 'done';
    status.sidecar = sidecar;
    batch.done++;

    // Post-write readback — only when DEBUG_METADATA=1. Verifies XMP-dc:Subject
    // appears in sidecars and all core fields round-trip correctly.
    if (process.env.DEBUG_METADATA === '1') {
      const verifyPath = sidecar || file.dest;
      const et = _getExifTool();
      const rb = await et.read(verifyPath);
      const label = `[exifService] Readback ${path.basename(verifyPath)}`;
      log(`${label} — Subject:${JSON.stringify(rb.Subject ?? rb['XMP-dc:Subject'] ?? 'MISSING')}`);
      log(`${label} — Creator:${JSON.stringify(rb.Creator ?? rb['XMP-dc:Creator'] ?? 'MISSING')}`);
      log(`${label} — Rights:${JSON.stringify(rb.Rights ?? rb['XMP-dc:Rights'] ?? 'MISSING')}`);
      log(`${label} — Marked:${JSON.stringify(rb.Marked ?? rb['XMP-xmpRights:Marked'] ?? 'MISSING')}`);
      if (tags['XMP-ajs:HijriDate']) {
        log(`${label} — HijriDate:${JSON.stringify(rb.HijriDate ?? rb['XMP-ajs:HijriDate'] ?? 'MISSING')}`);
      }
    }
  } catch (err) {
    status.status = 'error';
    status.error  = err.message;
    batch.failed++;
    log(`[exifService] Write failed: ${file.dest} | ${err.message}`);
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
    status: 'pending', src: f.src, dest: f.dest, photographer: f.photographer ?? null, sidecar: null, error: null,
  }));

  // Store context alongside batch so retries re-use the event.json-derived context,
  // never a stale renderer-side snapshot.
  const batch = { total: copiedFiles.length, done: 0, skipped: 0, failed: 0, files: fileStatuses, _context: context };
  _batches.set(batchId, batch);

  if (emitFn) emitFn({ batchId, event: 'batch_start', total: batch.total });

  copiedFiles.forEach((file, idx) => {
    _enqueue(async () => {
      const status = batch.files[idx];
      await _processFile(file, status, batch, context);

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

  const context = batch._context;

  for (const { f } of toRetry) {
    batch.failed--;
    f.status = 'pending';
    f.error  = null;
  }

  for (const { idx } of toRetry) {
    const file   = batch.files[idx];
    const status = file;

    _enqueue(async () => {
      await _processFile({ src: file.src, dest: file.dest, photographer: file.photographer ?? null }, status, batch, context);

      if (emitFn) {
        emitFn({
          batchId, event: 'file_done',
          index: idx, dest: file.dest, status: status.status,
          done: batch.done, skipped: batch.skipped, failed: batch.failed, total: batch.total,
        });
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

module.exports = { applyBatch, retryFailed, getBatchStatus, shutdown };
