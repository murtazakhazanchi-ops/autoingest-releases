'use strict';

const path   = require('path');
const fsp    = require('fs').promises;
const exifr  = require('exifr');
const { log } = require('../services/logger');
const config = require('../config/app.config');

const STATE_FILE  = 'qmz-sequences.json';
const UNSEQUENCED = '_Unsequenced';
const SEQ_RE      = /^\d{2}[QMZ]$/;
// Mirrors services/photographerSequenceService.js's PC_PREFIX_RE — duplicated
// locally rather than imported, matching this file's existing convention of
// staying decoupled from other main-process modules (see mediaType/isJunkFile
// above). Used only to recognize the malformed-but-unambiguous
// "PCxx-_Unsequenced" shape a pre-fix photographer-sequencing run can have
// left behind (bug: qmz-nested-unsequenced) — never to rename anything.
const PC_PREFIX_RE = /^PC(\d{2,3})-/;
function _stripPcPrefix(name) {
  return (name || '').replace(PC_PREFIX_RE, '');
}
const LETTER_TYPE = { Q: 'Qadam', M: 'Majlis', Z: 'Ziyafat' };
const LETTER_MAX  = { Q: 50, M: 51, Z: 52 };
const MEDIA_EXT   = new Set([...config.PHOTO_EXTENSIONS, ...config.VIDEO_EXTENSIONS]);
const RAW_EXTS    = new Set(config.RAW_EXTENSIONS);
const PHOTO_EXTS  = new Set(config.PHOTO_EXTENSIONS);
const VIDEO_EXTS  = new Set(config.VIDEO_EXTENSIONS);

// ── Original capture date (EXIF) ────────────────────────────────────────────
// Import's own file listing (main/fileBrowser.js) only ever records
// stat.mtime, and fs.copyFile() during import does not preserve source mtime
// across a cross-volume copy (SD card → archive) — so filesystem mtime is not
// a reliable proxy for capture time. The original capture date is baked into
// the file's own bytes (EXIF) and survives any copy/move, so QMZ reads it
// directly instead. Filesystem mtime is used ONLY as a last-resort fallback
// when no embedded capture date can be read at all.
//
// Two readers, chosen by file type:
//   - photo (JPEG/PNG/TIFF/…): exifr, in-process, fast tag-only parse.
//   - raw   (CR2/CR3/ARW/…):   ExifTool, via main/exifService.js's existing
//     readFileTags() — reuses that module's already-running, singleton
//     ExifTool process pool (no second pool spawned). QMZ deliberately does
//     NOT use exifr for RAW: services/thumbnailer.js already established that
//     exifr can leak file descriptors on malformed/exotic RAW formats, and
//     that restriction is mirrored here rather than relaxed. ExifTool runs as
//     a persistent external process, so it carries none of that fd-leak risk.
//   - video: not attempted here (no existing video capture-date extraction in
//     this project) — falls back to mtime, same as before.
//
// Both readers share one timeout-guarded, cached entry point (readCaptureDate)
// below. Never writes anything — read-only, exactly like readFileTags itself.
const EXIF_DATE_TIMEOUT_MS     = 500; // exifr — fast in-process parse
const RAW_EXIF_TIMEOUT_MS      = 800; // ExifTool — persistent process + possible NAS round-trip
// Bug 2 perf fix: listMediaFiles() used to read each RAW file's capture date
// one at a time (`for (...) await readCaptureDate(...)`), serializing every
// ExifTool round-trip — measured at 100-400ms+ each even against tiny
// placeholder files, so a single ~1200-RAW photographer folder over SMB
// stalled the entire QMZ workspace open for minutes. Bounded to match
// main/exifService.js's own ExifTool pool size (`maxProcs: 4`) so this
// actually exploits the pool's real parallel capacity instead of leaving
// most of it idle, without over-saturating a pool shared with other
// in-flight metadata work (import, repair).
const CAPTURE_DATE_CONCURRENCY = 4;
// Cache avoids re-reading EXIF on every _qmzRefresh() rescan for files that
// haven't changed. Keyed like the thumbnail cache (path+size+mtime) so a
// moved/renamed file (new path after sequence assignment) or a genuinely
// changed file gets a fresh read. Values are tiny ISO strings — an unbounded
// Map is negligible memory even for large archives.
const _exifDateCache = new Map();

async function _readPhotoCaptureDate(filePath) {
  try {
    const exifPromise    = exifr.parse(filePath, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), EXIF_DATE_TIMEOUT_MS));
    const tags = await Promise.race([exifPromise, timeoutPromise]);
    const date = tags?.DateTimeOriginal || tags?.CreateDate;
    return (date instanceof Date && !isNaN(date)) ? date.toISOString() : null;
  } catch {
    return null; // malformed/unreadable EXIF — caller falls back to mtime
  }
}

async function _readRawCaptureDate(filePath) {
  try {
    // Lazy require — keeps exifService's ExifTool pool from spawning until a
    // RAW file actually needs a date read, and avoids a load-order dependency
    // between the two main-process modules.
    const { readFileTags } = require('./exifService');
    const readPromise     = readFileTags(filePath);
    const timeoutPromise  = new Promise(resolve => setTimeout(() => resolve(null), RAW_EXIF_TIMEOUT_MS));
    const tags = await Promise.race([readPromise, timeoutPromise]);
    if (!tags) return null;
    // Prefer SubSecDateTimeOriginal (sub-second precision) when the camera
    // wrote it; otherwise DateTimeOriginal; CreateDate as a last EXIF resort.
    const raw = tags.SubSecDateTimeOriginal || tags.DateTimeOriginal || tags.CreateDate;
    if (!raw) return null;
    // exiftool-vendored returns ExifDateTime objects (with their own
    // .toISOString()) for recognized date tags, but falls back to a plain
    // string for tags it couldn't fully parse — handle both.
    if (typeof raw.toISOString === 'function') return raw.toISOString() || null;
    const parsed = new Date(raw);
    return isNaN(parsed) ? null : parsed.toISOString();
  } catch {
    return null; // malformed/unreadable EXIF, or ExifTool pool error — caller falls back to mtime
  }
}

async function readCaptureDate(filePath, size, mtimeMs, type) {
  const cacheKey = `${filePath}|${size}|${mtimeMs}`;
  if (_exifDateCache.has(cacheKey)) return _exifDateCache.get(cacheKey);
  let result = null;
  if (type === 'raw') result = await _readRawCaptureDate(filePath);
  else if (type === 'photo') result = await _readPhotoCaptureDate(filePath);
  // video: no reader yet — result stays null, caller falls back to mtime.
  _exifDateCache.set(cacheKey, result);
  return result;
}

// Mirrors main/fileBrowser.js's mediaType() — RAW checked before photo (RAW_EXTS ⊂ PHOTO_EXTS).
// Duplicated locally rather than imported to keep qmzService decoupled from fileBrowser.
function mediaType(filename) {
  const e = path.extname(filename).toLowerCase();
  if (RAW_EXTS.has(e))   return 'raw';
  if (PHOTO_EXTS.has(e)) return 'photo';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

// Mirrors main/fileBrowser.js's isJunkFile() — macOS AppleDouble sidecars
// (._Foo.ARW) and .DS_Store must never surface as media, even though their
// extension alone would otherwise match MEDIA_EXT (e.g. "._Foo.ARW" → .ARW).
function isJunkFile(filename) {
  return filename.startsWith('._') || filename === '.DS_Store';
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatCode(number, letter) {
  return String(number).padStart(2, '0') + String(letter).toUpperCase();
}

function parseCode(code) {
  if (typeof code !== 'string' || !SEQ_RE.test(code)) return null;
  const letter = code[2];
  const number = parseInt(code, 10);
  if (!LETTER_TYPE[letter]) return null;
  return { number, letter, type: LETTER_TYPE[letter], code, folderName: code };
}

function letterToType(letter) {
  return LETTER_TYPE[String(letter ?? '').toUpperCase()] ?? null;
}

// Runs `worker` over `items` with at most `limit` concurrent in flight at
// once, preserving input order in the returned array regardless of which
// worker finishes first (each worker writes to its own fixed index). No new
// dependency for a small, well-understood pattern — used by
// listMediaFiles() to bound its ExifTool/stat round-trips (see
// CAPTURE_DATE_CONCURRENCY) instead of a raw Promise.all (unbounded — would
// fire hundreds/thousands of concurrent ExifTool calls at once) or a
// sequential for-loop (the one-at-a-time stall this was written to fix).
async function _mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, runOne));
  return results;
}

// ── Filesystem helpers ────────────────────────────────────────────────────────

async function resolveConflict(filePath) {
  const ext  = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  for (let i = 1; i <= 99; i++) {
    const cand = `${base}_${i}${ext}`;
    try { await fsp.access(cand); } catch { return cand; }
  }
  throw new Error(`Cannot resolve filename conflict: ${path.basename(filePath)}`);
}

// Move a single file with no-overwrite safety. Same size at dest → skip (already moved).
// Conflicting dest → rename source with _1, _2 suffix.
async function safeMoveFile(src, dest) {
  let srcStat;
  try { srcStat = await fsp.stat(src); }
  catch { return { ok: false, reason: 'source-missing' }; }

  let finalDest = dest;
  try {
    const destStat = await fsp.stat(dest);
    if (destStat.size === srcStat.size) return { ok: true, dest, action: 'skipped' };
    finalDest = await resolveConflict(dest);
  } catch { /* dest absent — proceed */ }

  await fsp.mkdir(path.dirname(finalDest), { recursive: true });
  await fsp.rename(src, finalDest);
  return { ok: true, dest: finalDest, action: finalDest === dest ? 'moved' : 'moved-renamed' };
}

// Move a file and co-move its XMP sidecar if one exists alongside it.
async function moveWithSidecar(src, destDir) {
  const result = await safeMoveFile(src, path.join(destDir, path.basename(src)));
  const ext    = path.extname(src);
  const xmpSrc = src.slice(0, -ext.length) + '.xmp';
  try {
    await fsp.access(xmpSrc);
    await safeMoveFile(xmpSrc, path.join(destDir, path.basename(xmpSrc)));
  } catch { /* no sidecar */ }
  return result;
}

// Removes `dir` only if it contains nothing but macOS junk (._*, .DS_Store) or
// is fully empty — a real file or a subdirectory of any kind blocks removal.
// Junk files are deleted first (never media), then the now-truly-empty
// directory. Best-effort: any error (missing, not empty, permission) is
// swallowed — this is cosmetic cleanup and must never fail the caller's move.
async function removeIfEmptyIgnoringJunk(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const hasRealContent = entries.some(e => !(e.isFile() && isJunkFile(e.name)));
    if (hasRealContent) return; // real file or any subdirectory — leave it alone
    for (const e of entries) {
      if (e.isFile() && isJunkFile(e.name)) {
        try { await fsp.unlink(path.join(dir, e.name)); } catch {}
      }
    }
    await fsp.rmdir(dir);
  } catch { /* best-effort — never throw */ }
}

// Filesystem hardening (mirrors main/main.js's BUG-011 fix for master:scanEvents):
// Dirent.isDirectory()/isFile() can misreport on some network shares — a
// documented class of Node/libuv behavior, not specific to any one code path.
// main.js's event scanner already recovers from this by falling back to a real
// stat() when the Dirent disagrees; qmzService.js's own directory listing was
// written independently and never got the same protection, so a QMZ component
// whose _Unsequenced/photographer folders hit this on a real Windows/NAS
// archive could silently report zero photographers/media even though the
// folders and files are genuinely present on disk (bug: qmz-nested-unsequenced,
// "already opened by old workspace" follow-up). Only adds a stat() call on the
// rare disagreement path — the common case (Dirent and stat agree) is
// unaffected.
async function _directoryHardened(parentDir, entry) {
  if (entry.isDirectory()) return true;
  try {
    const st = await fsp.stat(path.join(parentDir, entry.name));
    if (st.isDirectory()) {
      log(`[qmz] DIRENT/STAT MISMATCH name=${JSON.stringify(entry.name)} parent=${JSON.stringify(parentDir)} `
        + `dirent.isDirectory()=false stat.isDirectory()=true — accepting stat() result, treating as a directory`);
      return true;
    }
  } catch { /* stat failed too — genuinely not a directory (or gone) */ }
  return false;
}

async function _fileHardened(parentDir, entry) {
  if (entry.isFile()) return true;
  try {
    const st = await fsp.stat(path.join(parentDir, entry.name));
    if (st.isFile()) {
      log(`[qmz] DIRENT/STAT MISMATCH name=${JSON.stringify(entry.name)} parent=${JSON.stringify(parentDir)} `
        + `dirent.isFile()=false stat.isFile()=true — accepting stat() result, treating as a file`);
      return true;
    }
  } catch { /* stat failed too — genuinely not a file (or gone) */ }
  return false;
}

async function listChildDirs(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const result  = [];
    for (const e of entries) {
      if (await _directoryHardened(dir, e)) result.push(e.name);
    }
    return result;
  } catch { return []; }
}

async function listMediaFiles(dir) {
  // Perf diagnostics (Bug 2 forensic investigation — Leicester ~30s+ stall on
  // a ~2400-entry photographer directory over SMB). Aggregate counts/timings
  // only, logged once per directory — never per-file. Measurement proved the
  // stall was NOT the Dirent hardening (statFallback count was 0 on a normal
  // filesystem) but the per-file readCaptureDate()/ExifTool round-trip below
  // — 99.7% of wall time in a 50-file measurement — run one at a time via a
  // sequential `for...await` loop. Kept so a future regression is visible
  // immediately in app.log rather than silently reintroducing the stall.
  const _t0 = Date.now();
  let _rawEntryCount = 0, _readdirMs = 0;
  let _direntSaysFile = 0, _direntNotFile = 0;
  let _statFallbackCount = 0, _statFallbackTotalMs = 0, _statFallbackMaxMs = 0;
  let _mandatoryStatTotalMs = 0, _mandatoryStatMaxMs = 0;
  let _captureDateCount = 0, _captureDateTotalMs = 0, _captureDateMaxMs = 0;
  let _mediaFound = 0, _ignoredByExt = 0;
  try {
    const _rd0 = Date.now();
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    _readdirMs = Date.now() - _rd0;
    _rawEntryCount = entries.length;

    const candidates = entries.filter(e => {
      if (isJunkFile(e.name) || !MEDIA_EXT.has(path.extname(e.name).toLowerCase())) { _ignoredByExt++; return false; }
      return true;
    });

    // Bounded-concurrency classification + stat + capture-date read. This is
    // the expensive part on a real network share — each ExifTool round-trip
    // alone measured 100-400ms even against tiny placeholder files, and a
    // Leicester-scale photographer folder (~1200 RAW files) has no video/
    // sequential shortcut, so a naive one-at-a-time loop stalls the whole
    // QMZ workspace open for minutes. Bounded to CAPTURE_DATE_CONCURRENCY —
    // matching main/exifService.js's own ExifTool pool size (maxProcs: 4) —
    // so this actually uses the pool's real parallel capacity instead of
    // leaving 3 of 4 worker processes idle the entire time, without
    // over-saturating a pool shared with other in-flight metadata work.
    // _mapWithConcurrency preserves input order in its results regardless of
    // completion order, so output stays deterministic.
    const results = await _mapWithConcurrency(candidates, CAPTURE_DATE_CONCURRENCY, async (e) => {
      if (e.isFile()) {
        _direntSaysFile++;
      } else {
        _direntNotFile++;
        const _sf0 = Date.now();
        const hardened = await _fileHardened(dir, e);
        const _sfMs = Date.now() - _sf0;
        _statFallbackCount++;
        _statFallbackTotalMs += _sfMs;
        if (_sfMs > _statFallbackMaxMs) _statFallbackMaxMs = _sfMs;
        if (!hardened) return null;
      }
      _mediaFound++;
      const p    = path.join(dir, e.name);
      const type = mediaType(e.name);
      let size = 0;
      let modifiedAt = null;
      let capturedAt = null;
      try {
        const _st0 = Date.now();
        const stat = await fsp.stat(p);
        const _stMs = Date.now() - _st0;
        _mandatoryStatTotalMs += _stMs;
        if (_stMs > _mandatoryStatMaxMs) _mandatoryStatMaxMs = _stMs;
        size       = stat.size;
        modifiedAt = stat.mtime.toISOString();
        // Preferred: original capture date, read per-type (see note above).
        // Fallback only: filesystem modified time — used below when this is
        // null, i.e. no embedded capture date could be read at all.
        if (type === 'photo' || type === 'raw') {
          const _cd0 = Date.now();
          capturedAt = await readCaptureDate(p, stat.size, stat.mtimeMs, type);
          const _cdMs = Date.now() - _cd0;
          _captureDateCount++;
          _captureDateTotalMs += _cdMs;
          if (_cdMs > _captureDateMaxMs) _captureDateMaxMs = _cdMs;
        }
      } catch {}
      return { name: e.name, path: p, size, type, modifiedAt, capturedAt: capturedAt || modifiedAt };
    });
    const files = results.filter(Boolean);

    log(`[qmz-perf] listMediaFiles dir=${JSON.stringify(dir)} totalMs=${Date.now() - _t0} readdirMs=${_readdirMs} `
      + `rawEntries=${_rawEntryCount} ignoredByExt=${_ignoredByExt} direntSaysFile=${_direntSaysFile} direntNotFile=${_direntNotFile} `
      + `statFallback: count=${_statFallbackCount} totalMs=${_statFallbackTotalMs} maxMs=${_statFallbackMaxMs} `
      + `mandatoryStat: totalMs=${_mandatoryStatTotalMs} maxMs=${_mandatoryStatMaxMs} `
      + `captureDate(readCaptureDate/ExifTool): count=${_captureDateCount} totalMs=${_captureDateTotalMs} maxMs=${_captureDateMaxMs} `
      + `mediaFound=${_mediaFound} concurrency=${CAPTURE_DATE_CONCURRENCY}`);
    return files;
  } catch (err) {
    log(`[qmz-perf] listMediaFiles dir=${JSON.stringify(dir)} FAILED after ${Date.now() - _t0}ms: ${err.message}`);
    return [];
  }
}

// True if `code`'s sequence folder has any photographer subfolder containing
// at least one real (non-junk) media file. Only inspects one level of
// nesting — sequence folders only ever contain photographer folders directly.
async function _sequenceHasFiles(qmzRoot, code) {
  const pgDirs = await listChildDirs(path.join(qmzRoot, code));
  for (const pg of pgDirs) {
    const files = await listMediaFiles(path.join(qmzRoot, code, pg));
    if (files.length > 0) return true;
  }
  return false;
}

// ── State I/O ────────────────────────────────────────────────────────────────

async function readState(qmzRoot) {
  try {
    const raw = await fsp.readFile(path.join(qmzRoot, STATE_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, qmzRoot, sequences: [] };
  }
}

async function saveState(qmzRoot, state) {
  const dest = path.join(qmzRoot, STATE_FILE);
  const tmp  = dest + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, dest);
    return { ok: true };
  } catch (err) {
    log(`[qmz] saveState failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/**
 * Scan qmzRoot and return its current structure.
 *   sequences   — sorted array of { code, type, photographers: { name: { count, files[] } } }
 *   unsequenced — { photographerName: { count, files[] } }
 *   other       — plain dirs that are neither sequences nor _Unsequenced (adoption candidates)
 *   state       — parsed qmz-sequences.json (or default)
 */
async function scanRoot(qmzRoot) {
  // TEMPORARY diagnostics (Bug 2 forensic investigation — remove once the
  // Leicester "empty QMZ workspace" root cause is confirmed). Raw readdir
  // names only (never file contents), so this stays safe to leave on for a
  // real reproduction without flooding app.log.
  let _rawRootEntries = null;
  try { _rawRootEntries = (await fsp.readdir(qmzRoot, { withFileTypes: true })).map(e => `${e.name}${e.isDirectory() ? '/' : ''}`); }
  catch (err) { _rawRootEntries = [`<readdir THREW: ${err.code || err.message}>`]; }
  log(`[qmz-diag] scanRoot ENTER root=${JSON.stringify(qmzRoot)} rawReaddir=${JSON.stringify(_rawRootEntries)}`);

  const [childDirs, state] = await Promise.all([listChildDirs(qmzRoot), readState(qmzRoot)]);
  log(`[qmz-diag] scanRoot hardened childDirs=${JSON.stringify(childDirs)}`);
  const sequences   = [];
  const unsequenced = {};
  const other       = [];

  for (const dir of childDirs) {
    if (dir === UNSEQUENCED) {
      const unseqPath = path.join(qmzRoot, UNSEQUENCED);
      let _rawUnseqEntries = null;
      try { _rawUnseqEntries = (await fsp.readdir(unseqPath, { withFileTypes: true })).map(e => `${e.name}${e.isDirectory() ? '/' : ''}`); }
      catch (err) { _rawUnseqEntries = [`<readdir THREW: ${err.code || err.message}>`]; }
      log(`[qmz-diag] scanRoot _Unsequenced chosenPath=${JSON.stringify(unseqPath)} rawReaddir=${JSON.stringify(_rawUnseqEntries)}`);
      const pgDirs = await listChildDirs(path.join(qmzRoot, UNSEQUENCED));
      log(`[qmz-diag] scanRoot _Unsequenced hardened children (classified as directories)=${JSON.stringify(pgDirs)}`);
      for (const pg of pgDirs) {
        const pgPath = path.join(qmzRoot, UNSEQUENCED, pg);
        // Recovery for archives affected by the (now-fixed) bug where running
        // photographer sequencing against a QMZ root renamed "_Unsequenced"
        // itself into "PCxx-_Unsequenced", which initRoot then nested INSIDE
        // _Unsequenced/ as a plain adoption candidate — leaving real media two
        // levels deeper than this scan expects (0 files reported). Recognize
        // that malformed-but-unambiguous shape — a child of _Unsequenced whose
        // canonical name (PCxx- prefix stripped) is itself "_Unsequenced" —
        // and read straight through it to the real nested photographer
        // folders. Read-only: no filesystem move is performed here.
        if (_stripPcPrefix(pg) === UNSEQUENCED) {
          log(`[qmz-diag] scanRoot child=${JSON.stringify(pg)} classified=ALIAS(_Unsequenced) — reading through to nested photographers`);
          const nestedPgDirs = await listChildDirs(pgPath);
          for (const nestedPg of nestedPgDirs) {
            const files = await listMediaFiles(path.join(pgPath, nestedPg));
            log(`[qmz-diag] scanRoot   nested photographer=${JSON.stringify(nestedPg)} canonical=${JSON.stringify(_stripPcPrefix(nestedPg))} mediaCount=${files.length}`);
            const existing = unsequenced[nestedPg];
            unsequenced[nestedPg] = existing
              ? { count: existing.count + files.length, files: [...existing.files, ...files] }
              : { count: files.length, files };
          }
          continue;
        }
        // TEMPORARY (Bug 2 perf investigation): times this specific await so
        // a stall can be attributed precisely to listMediaFiles(pgPath), not
        // to something else running between diagnostic log lines.
        const _lmf0 = Date.now();
        const files = await listMediaFiles(pgPath);
        log(`[qmz-perf] scanRoot await listMediaFiles(${JSON.stringify(pgPath)}) took ${Date.now() - _lmf0}ms`);
        log(`[qmz-diag] scanRoot child=${JSON.stringify(pg)} classified=PHOTOGRAPHER canonical=${JSON.stringify(_stripPcPrefix(pg))} mediaCount=${files.length}`);
        unsequenced[pg] = { count: files.length, files };
      }
    } else if (SEQ_RE.test(dir)) {
      const parsed = parseCode(dir);
      const pgDirs = await listChildDirs(path.join(qmzRoot, dir));
      const photographers = {};
      for (const pg of pgDirs) {
        const files = await listMediaFiles(path.join(qmzRoot, dir, pg));
        photographers[pg] = { count: files.length, files };
      }
      sequences.push({ ...parsed, photographers });
    } else {
      other.push(dir);
    }
  }

  sequences.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  log(`[qmz-diag] scanRoot RESULT root=${JSON.stringify(qmzRoot)} `
    + `unsequenced=${JSON.stringify(Object.entries(unsequenced).map(([k, v]) => `${k}:${v.count}`))} `
    + `sequences=${JSON.stringify(sequences.map(s => s.code))} other=${JSON.stringify(other)}`);
  return { sequences, unsequenced, other, state };
}

// ── Init ─────────────────────────────────────────────────────────────────────

// Moves every FILE (not subdirectory) directly inside srcDir into destDir via
// the same no-overwrite-safe safeMoveFile used everywhere else, then removes
// srcDir if it ended up empty. Shared by the standard adoption-collision merge
// and the "_Unsequenced" alias recovery merge below — both need the identical
// safe, file-by-file behavior, just at a different nesting depth.
async function _mergeDirFilesInto(srcDir, destDir, errors, label) {
  let entries;
  try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); }
  catch (err) { errors.push({ dir: label, error: err.message }); return; }

  for (const e of entries) {
    if (!(await _fileHardened(srcDir, e))) continue;
    const r = await safeMoveFile(path.join(srcDir, e.name), path.join(destDir, e.name));
    if (!r.ok) errors.push({ dir: label, file: e.name, error: r.reason });
  }
  try {
    const rem = await fsp.readdir(srcDir);
    if (rem.length === 0) await fsp.rmdir(srcDir);
  } catch {}
}

/**
 * Adopt plain photographer folders (not sequence dirs, not _Unsequenced) into _Unsequenced/.
 * Uses atomic rename where possible; merges file-by-file when _Unsequenced/<dir> already exists.
 *
 * Recovery/prevention (bug: qmz-nested-unsequenced): a folder whose canonical
 * name (PCxx- prefix stripped) is itself "_Unsequenced" is "_Unsequenced"
 * mistakenly renamed by a (now-fixed) photographer-sequencing run against a
 * QMZ root — it is NOT a real photographer folder. Adopting it as a single
 * unit under _Unsequenced/ would create exactly the double-nesting this bug
 * report is about (real media ending up two levels deeper than the scanner
 * expects). Instead, its children — the real photographer folders — are
 * merged directly into _Unsequenced/, one level flattened, using the same
 * safe per-file move as every other adoption path here.
 */
async function initRoot(qmzRoot) {
  log(`[qmz-diag] initRoot ENTER root=${JSON.stringify(qmzRoot)}`);
  const scan    = await scanRoot(qmzRoot);
  const adopted = [];
  const errors  = [];

  const unsequencedDir = path.join(qmzRoot, UNSEQUENCED);
  await fsp.mkdir(unsequencedDir, { recursive: true });

  for (const dirName of scan.other) {
    if (_stripPcPrefix(dirName) === UNSEQUENCED) {
      const aliasDir = path.join(qmzRoot, dirName);
      let children;
      try { children = await fsp.readdir(aliasDir, { withFileTypes: true }); }
      catch (err) { errors.push({ dir: dirName, error: err.message }); continue; }

      for (const child of children) {
        if (!(await _directoryHardened(aliasDir, child))) continue; // stray files directly under the alias — leave in place, never guessed at
        const childSrc  = path.join(aliasDir, child.name);
        const childDest = path.join(unsequencedDir, child.name);
        try {
          await fsp.rename(childSrc, childDest);
        } catch {
          await _mergeDirFilesInto(childSrc, childDest, errors, `${dirName}/${child.name}`);
        }
      }
      try {
        const rem = await fsp.readdir(aliasDir);
        if (rem.length === 0) await fsp.rmdir(aliasDir);
      } catch {}
      adopted.push(dirName);
      continue;
    }

    const srcDir  = path.join(qmzRoot, dirName);
    const destDir = path.join(unsequencedDir, dirName);
    try {
      await fsp.rename(srcDir, destDir);
      adopted.push(dirName);
    } catch {
      // _Unsequenced/<dirName> already exists — merge file by file
      await _mergeDirFilesInto(srcDir, destDir, errors, dirName);
      adopted.push(dirName);
    }
  }

  log(`[qmz] initRoot: adopted ${adopted.length} folder(s) into ${UNSEQUENCED}`);
  return { ok: true, adopted, errors };
}

// ── Create sequences ─────────────────────────────────────────────────────────

async function createSequence(qmzRoot, number, letter) {
  letter = String(letter ?? '').toUpperCase();
  if (!LETTER_TYPE[letter]) return { ok: false, error: `Invalid letter: ${letter}` };
  const max = LETTER_MAX[letter];
  if (!Number.isInteger(number) || number < 1 || number > max)
    return { ok: false, error: `Number out of range for ${letter}: ${number} (1–${max})` };

  const code = formatCode(number, letter);
  try { await fsp.mkdir(path.join(qmzRoot, code), { recursive: true }); }
  catch (err) { return { ok: false, error: err.message }; }

  const state   = await readState(qmzRoot);
  const already = state.sequences.some(s => s.code === code);
  if (!already) {
    state.sequences.push({ code, number, letter, type: LETTER_TYPE[letter] });
    state.sequences.sort((a, b) => (a.code < b.code ? -1 : 1));
    const r = await saveState(qmzRoot, state);
    if (!r.ok) return { ok: false, error: r.error };
  }

  return { ok: true, code };
}

async function bulkCreateSequences(qmzRoot, items) {
  const created = [];
  const errors  = [];
  for (const { number, letter } of items) {
    const r = await createSequence(qmzRoot, number, letter);
    if (r.ok) created.push(r.code);
    else errors.push({ number, letter, error: r.error });
  }
  return { ok: errors.length === 0, created, errors };
}

// ── Edit / remove sequences ──────────────────────────────────────────────────
// MVP scope: only an EMPTY sequence (no real files in any photographer
// subfolder) may be edited or removed. A non-empty sequence is blocked with a
// clear message rather than silently reassigning/deleting anything — no
// batch re-tagging or renumbering is attempted here.

async function editSequenceType(qmzRoot, code, newLetter) {
  const parsed = parseCode(code);
  if (!parsed) return { ok: false, error: `Invalid sequence code: ${code}` };
  newLetter = String(newLetter ?? '').toUpperCase();
  if (!LETTER_TYPE[newLetter]) return { ok: false, error: `Invalid letter: ${newLetter}` };
  if (newLetter === parsed.letter) return { ok: true, code }; // no-op, already this type

  if (await _sequenceHasFiles(qmzRoot, code)) {
    return { ok: false, error: 'Move files out of this sequence before changing its type.' };
  }

  const newCode = formatCode(parsed.number, newLetter);
  const state   = await readState(qmzRoot);
  if (state.sequences.some(s => s.code === newCode)) {
    return { ok: false, error: `Sequence ${newCode} already exists.` };
  }

  const srcDir  = path.join(qmzRoot, code);
  const destDir = path.join(qmzRoot, newCode);
  try { await fsp.access(destDir); return { ok: false, error: `Folder ${newCode} already exists on disk.` }; }
  catch { /* dest absent — proceed */ }
  try { await fsp.rename(srcDir, destDir); }
  catch (err) { return { ok: false, error: err.message }; }

  state.sequences = state.sequences.map(s => s.code === code
    ? { code: newCode, number: parsed.number, letter: newLetter, type: LETTER_TYPE[newLetter] }
    : s);
  state.sequences.sort((a, b) => (a.code < b.code ? -1 : 1));
  const r = await saveState(qmzRoot, state);
  if (!r.ok) return { ok: false, error: r.error };

  log(`[qmz] editSequenceType: ${code} → ${newCode}`);
  return { ok: true, code: newCode };
}

async function removeSequence(qmzRoot, code) {
  const parsed = parseCode(code);
  if (!parsed) return { ok: false, error: `Invalid sequence code: ${code}` };

  if (await _sequenceHasFiles(qmzRoot, code)) {
    return { ok: false, error: 'This sequence contains files. Move them back to Unsequenced before removing the sequence.' };
  }

  const seqDir = path.join(qmzRoot, code);
  try {
    const pgDirs = await listChildDirs(seqDir);
    for (const pg of pgDirs) {
      await removeIfEmptyIgnoringJunk(path.join(seqDir, pg));
    }
    await removeIfEmptyIgnoringJunk(seqDir);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Only drop the sequence from state once the folder is verifiably gone —
  // if any unexpected content survived cleanup, leave state and folder in
  // sync (still listed) rather than orphaning real content on disk.
  try {
    await fsp.access(seqDir);
    return { ok: false, error: 'Sequence folder is not empty.' };
  } catch { /* good — folder is gone */ }

  const state = await readState(qmzRoot);
  state.sequences = state.sequences.filter(s => s.code !== code);
  const r = await saveState(qmzRoot, state);
  if (!r.ok) return { ok: false, error: r.error };

  log(`[qmz] removeSequence: ${code} removed`);
  return { ok: true, code };
}

// ── Move files ────────────────────────────────────────────────────────────────

async function moveFilesToSequence(qmzRoot, filePaths, sequenceCode, photographerName) {
  if (!parseCode(sequenceCode)) return { ok: false, error: `Invalid sequence code: ${sequenceCode}` };
  const destDir = path.join(qmzRoot, sequenceCode, photographerName);
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  log(`[qmz] moveToSequence ${sequenceCode}/${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

async function moveFilesToUnsequenced(qmzRoot, filePaths, photographerName) {
  const destDir = path.join(qmzRoot, UNSEQUENCED, photographerName);
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  // Clean up any sequence photographer folder left empty by this move (real
  // files or unmoved leftovers block removal — see removeIfEmptyIgnoringJunk).
  // Only the leaf photographer folder is ever touched here, never the
  // sequence folder itself — that stays until the user explicitly removes it.
  const sourceDirs = new Set(moved.map(m => path.dirname(m.src)));
  for (const dir of sourceDirs) {
    await removeIfEmptyIgnoringJunk(dir);
  }

  log(`[qmz] moveToUnsequenced ${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  formatCode,
  parseCode,
  letterToType,
  readState,
  saveState,
  scanRoot,
  initRoot,
  createSequence,
  bulkCreateSequences,
  editSequenceType,
  removeSequence,
  moveFilesToSequence,
  moveFilesToUnsequenced,
  // Test-only: exposes the Dirent/stat hardening helpers so
  // test/qmzDirentMismatchRegression.test.js can exercise them directly
  // against a real fs.stat() with a faked Dirent, mirroring
  // test/bug011DirentMismatchRegression.test.js's established technique. Not
  // part of the module's real public API — no other caller should use these
  // directly; listChildDirs/listMediaFiles already apply them internally.
  _directoryHardened,
  _fileHardened,
};
