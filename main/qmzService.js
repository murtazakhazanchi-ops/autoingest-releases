'use strict';

const path   = require('path');
const fsp    = require('fs').promises;
const exifr  = require('exifr');
const { log } = require('../services/logger');
const config = require('../config/app.config');
// Security hardening (post-Stage-4) — the SAME Windows/UNC-safe containment check already
// used throughout main/main.js (archive-root/staging-root boundary checks). Reused here
// rather than a second, independently-written containment helper — see isPathUnderRoot's own
// header comment for exactly why a naive `x.startsWith(root)` is unsafe (it would wrongly
// treat "/archive/QMZ-Other" as contained in "/archive/QMZ").
const PathUtils = require('../renderer/pathUtils.js');
// The ONE definition of the QMZ sequence-code shape, shared with renderer/commandManager.js's
// MX Creative Console command validation (see qmzSequenceFormat.js's own header comment for
// why this extraction exists — a real drift between this file's SEQ_RE and commandManager.js's
// own independent copy was found and fixed in Stage 5's review).
const { SEQ_RE, LETTER_MAX, MAX_SEQUENCE_NUMBER } = require('../renderer/qmzSequenceFormat.js');
// QMZ workspace maintenance — reuses the SAME centralised hidden/protected-file mechanism
// already applied to event.json/event.metadata.json throughout main.js/metadataSyncService.js,
// rather than inventing a QMZ-specific one. See readState()/saveState()'s own comments for why
// this file is kept at its existing plain name (qmz-sequences.json) rather than renamed to a
// dot-prefixed one.
const { hidePathBestEffort } = require('../services/internalFileProtection');

const STATE_FILE  = 'qmz-sequences.json';
const UNSEQUENCED = '_Unsequenced';
// Stage 4 of "PDF-Assisted QMZ Workspace Folder Generation" — Enroute is a permanent,
// first-class sorting destination for photographs that do not belong to any numbered QMZ
// sequence. Deliberately NOT a sequence code: it has no number, no Q/M/Z/MZ type, and does
// not match SEQ_RE — it is recognized by exact literal name, the same way UNSEQUENCED already
// is, never by pattern. Capitalization is fixed ("Enroute", not "enroute"/"ENROUTE") — see
// ensureEnroute()'s own comment for why an existing folder with different casing is treated as
// a conflict rather than silently reused.
const ENROUTE_DIR = 'Enroute';
// SEQ_RE itself now lives in renderer/qmzSequenceFormat.js (required above) — capturing
// groups are used directly by parseCode() below (a capturing group does not change .test()'s
// boolean result, so the SAME regex is also used everywhere else here purely as a membership
// test: scanRoot, _classifyOtherFolders). The suffix, if present, is always part of the
// sequence's identity (two different suffixes are two different, independent sequences — see
// createSequence's duplicate check, which compares the full code string unchanged).
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
// "QMZ Sequence Enhancements" adds O (Olda) and AQ (Aqeeqa); MZ's label changes from the
// original "Majlis + Ziyafat" to "Majmui Ziyafat" (MZ itself is NOT a new code — only its
// display label changes; see docs/DEC-011-style precedent this task continues).
const LETTER_TYPE = { Q: 'Qadam', M: 'Majlis', Z: 'Ziyafat', MZ: 'Majmui Ziyafat', O: 'Olda', AQ: 'Aqeeqa' };
// Q/M/Z's specific ceilings (50/51/52) predate this feature and have no
// discoverable rationale anywhere in the codebase, commit history or product
// docs (git blame → commit b56f6ba, "feat(qmz): add QMZ Sequence Manager",
// introduces them with no explanation; DEC-011 confirms "type-specific
// maximums" is an intentional product concept but gives no numbers) — left
// completely untouched, per instruction, rather than reverse-engineered.
// MZ, O, and AQ deliberately have NO entry here: there is no product rationale to invent
// one for any of them. createSequence() falls back to MAX_SEQUENCE_NUMBER for any letter
// without its own configured ceiling — the sequence-code FORMAT's own structural limit (two
// zero-padded digits), not a business rule. O/AQ follow the exact same precedent already
// established for MZ (confirmed via AskUserQuestion in Stage 1), not a new ambiguity.
// Both constants now live in renderer/qmzSequenceFormat.js — the single source of truth also
// read by renderer.js's own pre-flight range checks (see that file's own comment for why).
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

// `suffix` is optional and backward-compatible: every existing call site omits
// it, producing byte-identical output to before (e.g. formatCode(1, 'Q') is
// still exactly "01Q"). Always lower-cased on the way out, regardless of how
// it was cased on the way in, per the sequence-folder naming convention
// (number, then lowercase suffix if any, then uppercase type — no separator).
function formatCode(number, letter, suffix = '') {
  return String(number).padStart(2, '0') + String(suffix || '').toLowerCase() + String(letter).toUpperCase();
}

// Returns { number, suffix, letter, type, code, folderName } or null for
// anything SEQ_RE doesn't recognize. `suffix` is '' (never undefined) for a
// plain code like "01Q" — existing callers reading only .number/.letter/
// .type/.code/.folderName are completely unaffected by its addition.
function parseCode(code) {
  if (typeof code !== 'string') return null;
  const m = SEQ_RE.exec(code);
  if (!m) return null;
  const [, numStr, suffix, letter] = m;
  const number = parseInt(numStr, 10);
  if (!LETTER_TYPE[letter]) return null; // defensive — SEQ_RE's own alternation already guarantees this
  return { number, suffix, letter, type: LETTER_TYPE[letter], code, folderName: code };
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

// Bug 2 perf fix, round 2: real Windows/SMB measurement showed the bounded
// concurrency from the first perf fix (round 1, matching maxProcs: 4) was
// working exactly as designed (~4x wall-clock reduction vs sequential) but
// was nowhere near enough — real per-file ExifTool round trips measured
// ~300-500ms average on the tester's actual NAS (vs ~100-400ms against tiny
// local placeholder files), so a several-hundred-file photographer folder
// still took tens of seconds to minutes, and QMZ opens ALWAYS pay this twice
// (see initRoot's own comment below) with only the second pass warmed by
// _exifDateCache — explaining the observed "some scans become instant"
// pattern precisely.
//
// Root architectural question (per the forensic investigation): is
// authoritative EXIF capture date actually required before the QMZ
// workspace can become usable? Traced every consumer — renderer/renderer.js
// uses file.capturedAt in exactly three places, all display/ordering
// concerns (default 'date' sort comparator, the date label under each tile,
// and Timeline grouping) — never for photographer/folder discovery, RAW/XMP
// pairing, or any move/assign/sequence operation. None of those require an
// authoritative date to make the workspace interactive.
//
// listMediaFiles() therefore no longer blocks on readCaptureDate() at all —
// every file gets an immediate capturedAt of its filesystem modifiedAt (already
// available from the mandatory stat() below, at negligible cost) plus
// capturedAtPending:true for RAW/photo types, so the workspace, file cards,
// and default date-sort become available in the time it takes to stat the
// directory, not to run ExifTool across it. Real EXIF dates are then
// resolved by a separate, explicitly-triggered resolveCaptureDates() call —
// see that function below — which the renderer fires in the background
// immediately after the fast scan renders, and applies in place once ready
// (re-sorting/re-labeling without blocking anything, including selection,
// thumbnails, or sequence assignment in the meantime).
async function listMediaFiles(dir) {
  // Perf diagnostics — aggregate counts/timings only, logged once per
  // directory, never per-file.
  const _t0 = Date.now();
  let _rawEntryCount = 0, _readdirMs = 0;
  let _direntSaysFile = 0, _direntNotFile = 0;
  let _statFallbackCount = 0, _statFallbackTotalMs = 0, _statFallbackMaxMs = 0;
  let _mandatoryStatTotalMs = 0, _mandatoryStatMaxMs = 0;
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

    // Bounded-concurrency classification + stat (NOT capture-date — see the
    // function-level comment above). Still bounded, still hardened against
    // Windows/SMB Dirent misreports (BUG-011-class) exactly as round 1 left
    // it — only the capture-date work moved out of this synchronous path.
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
      try {
        const _st0 = Date.now();
        const stat = await fsp.stat(p);
        const _stMs = Date.now() - _st0;
        _mandatoryStatTotalMs += _stMs;
        if (_stMs > _mandatoryStatMaxMs) _mandatoryStatMaxMs = _stMs;
        size       = stat.size;
        modifiedAt = stat.mtime.toISOString();
      } catch {}
      const needsCaptureDate = type === 'photo' || type === 'raw';
      return {
        name: e.name, path: p, size, type, modifiedAt,
        // Provisional — filesystem mtime, not the camera's own capture
        // timestamp. Corrected in place by resolveCaptureDates() once the
        // real EXIF/embedded date is read, without blocking initial render.
        capturedAt: modifiedAt,
        capturedAtPending: needsCaptureDate,
      };
    });
    const files = results.filter(Boolean);

    log(`[qmz-perf] listMediaFiles dir=${JSON.stringify(dir)} totalMs=${Date.now() - _t0} readdirMs=${_readdirMs} `
      + `rawEntries=${_rawEntryCount} ignoredByExt=${_ignoredByExt} direntSaysFile=${_direntSaysFile} direntNotFile=${_direntNotFile} `
      + `statFallback: count=${_statFallbackCount} totalMs=${_statFallbackTotalMs} maxMs=${_statFallbackMaxMs} `
      + `mandatoryStat: totalMs=${_mandatoryStatTotalMs} maxMs=${_mandatoryStatMaxMs} `
      + `mediaFound=${_mediaFound} concurrency=${CAPTURE_DATE_CONCURRENCY}`);
    return files;
  } catch (err) {
    log(`[qmz-perf] listMediaFiles dir=${JSON.stringify(dir)} FAILED after ${Date.now() - _t0}ms: ${err.message}`);
    return [];
  }
}

/**
 * Resolves authoritative EXIF/embedded capture dates for a batch of files
 * already discovered by scanRoot() (i.e. carrying capturedAtPending:true).
 * Explicitly separate from listMediaFiles() so the initial scan never blocks
 * on it — see that function's header comment for the full rationale.
 *
 * Reuses the SAME bounded-concurrency mechanism and cache (_exifDateCache,
 * keyed path|size|mtimeMs) as before, so results are identical to what the
 * old synchronous path would have produced — this only changes WHEN the
 * work happens, not what it computes.
 *
 * @param {Array<{path:string, size:number, modifiedAt:string, type:string}>} files
 * @returns {Promise<{ [path]: string|null }>} capturedAt per input path
 *   (only for photo/raw entries — non-applicable entries are simply absent
 *   from the result, callers should leave their existing capturedAt as-is).
 */
async function resolveCaptureDates(files) {
  const _t0 = Date.now();
  const candidates = (files || []).filter(f => f && f.path && (f.type === 'photo' || f.type === 'raw'));
  const result = {};
  await _mapWithConcurrency(candidates, CAPTURE_DATE_CONCURRENCY, async (f) => {
    try {
      const mtimeMs = f.modifiedAt ? new Date(f.modifiedAt).getTime() : null;
      result[f.path] = await readCaptureDate(f.path, f.size, mtimeMs, f.type);
    } catch {
      result[f.path] = null;
    }
  });
  log(`[qmz-perf] resolveCaptureDates count=${candidates.length} totalMs=${Date.now() - _t0} concurrency=${CAPTURE_DATE_CONCURRENCY}`);
  return result;
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
//
// Workspace maintenance — qmz-sequences.json is hidden from normal Finder/Explorer browsing
// via hidePathBestEffort() (macOS chflags hidden / Windows attrib +H / Linux .hidden
// registry), the exact same centralised mechanism already used for event.json throughout the
// rest of the app — NOT by renaming the file to a dot-prefixed name. Investigated the
// alternative (".qmz-sequences.json") first: a dot-prefix is NOT honored as hidden by Windows
// Explorer at all, whereas chflags/attrib genuinely are on both platforms, and renaming would
// require a migration step (old name vs new name, conflicting-file reconciliation, etc.) that
// a pure attribute change does not — the on-disk filename, schema, and every existing sequence
// record stay completely untouched. hidePathBestEffort() is applied in readState() too (not
// only saveState()) so that simply OPENING a pre-existing/legacy workspace retroactively hides
// its already-created file — no explicit migration step is needed, every workspace becomes
// correctly hidden the next time it is either opened or saved to, whichever comes first.
// Best-effort and non-fatal by design (see that function's own header comment) — a failure to
// apply the attribute (e.g. a read-only NAS mount) never blocks reading or writing the actual
// sequence data.

async function readState(qmzRoot) {
  const dest = path.join(qmzRoot, STATE_FILE);
  try {
    const raw = await fsp.readFile(dest, 'utf8');
    hidePathBestEffort(dest).catch(() => {});
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
    hidePathBestEffort(dest).catch(() => {});
    return { ok: true };
  } catch (err) {
    log(`[qmz] saveState failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/**
 * Bug 2 perf fix, round 2: cheap top-level-only classification — readdir +
 * Dirent-hardened directory check, nothing else. Used by initRoot(), which
 * only ever needs the "other" (adoption-candidate) list; it never reads
 * scan.unsequenced or scan.sequences. Before this fix, initRoot() called the
 * FULL scanRoot() — which for every _Unsequenced/sequence child runs
 * listMediaFiles() (a per-file stat, formerly also an ExifTool round trip) —
 * purely to throw almost all of that expensive result away and use only
 * `.other`. Every QMZ open therefore paid the full per-photographer
 * discovery cost TWICE: once here (wasted), once more via the renderer's own
 * explicit scanRoot() call in _qmzRefresh() (the one whose result is
 * actually used) — this is the exact duplicate-scan mechanism behind the
 * "some scans become instant" observation from the real Windows/SMB
 * diagnostics: the second pass was fast only because _exifDateCache was
 * already warmed by the first, wasted one.
 */
async function _classifyOtherFolders(qmzRoot) {
  const childDirs = await listChildDirs(qmzRoot);
  const other = [];
  for (const dir of childDirs) {
    if (dir === UNSEQUENCED) continue;
    if (dir === ENROUTE_DIR) continue; // Stage 4 — Enroute is a known destination, never an adoption candidate
    if (SEQ_RE.test(dir)) continue;
    other.push(dir);
  }
  return other;
}

/**
 * Scan qmzRoot and return its current structure.
 *   sequences   — sorted array of { code, type, photographers: { name: { count, files[] } } }
 *   unsequenced — { photographerName: { count, files[] } }
 *   enroute     — { exists: boolean, photographers: { name: { count, files[] } } } (Stage 4 —
 *                  see ENROUTE_DIR's own comment; exists:false with photographers:{} when the
 *                  Enroute folder has not been created in this workspace yet)
 *   other       — plain dirs that are neither sequences, _Unsequenced, nor Enroute (adoption candidates)
 *   state       — parsed qmz-sequences.json (or default)
 */
async function scanRoot(qmzRoot) {
  const [childDirs, state] = await Promise.all([listChildDirs(qmzRoot), readState(qmzRoot)]);
  log(`[qmz-diag] scanRoot hardened childDirs=${JSON.stringify(childDirs)}`);
  const sequences   = [];
  const unsequenced = {};
  const enroute     = { exists: false, photographers: {} };
  const other       = [];

  for (const dir of childDirs) {
    if (dir === ENROUTE_DIR) {
      enroute.exists = true;
      const pgDirs = await listChildDirs(path.join(qmzRoot, ENROUTE_DIR));
      for (const pg of pgDirs) {
        const files = await listMediaFiles(path.join(qmzRoot, ENROUTE_DIR, pg));
        enroute.photographers[pg] = { count: files.length, files };
      }
    } else if (dir === UNSEQUENCED) {
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
        const files = await listMediaFiles(pgPath);
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
    + `sequences=${JSON.stringify(sequences.map(s => s.code))} `
    + `enroute=${enroute.exists ? JSON.stringify(Object.entries(enroute.photographers).map(([k, v]) => `${k}:${v.count}`)) : '(not created)'} `
    + `other=${JSON.stringify(other)}`);
  return { sequences, unsequenced, enroute, other, state };
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
  const other   = await _classifyOtherFolders(qmzRoot);
  const adopted = [];
  const errors  = [];

  const unsequencedDir = path.join(qmzRoot, UNSEQUENCED);
  // Workspace maintenance — previously created _Unsequenced unconditionally on every
  // initRoot() call (i.e. every QMZ workspace open), which is the exact reason a fully-sorted
  // workspace's empty _Unsequenced folder never actually disappeared: reopening the workspace
  // silently recreated it immediately. _Unsequenced is only genuinely needed here as an
  // adoption DESTINATION, so only create it when there is something to adopt into it — when
  // `other` is empty, this entire loop below is a no-op anyway, so there would be nothing to
  // put in a freshly-created directory. If _Unsequenced already exists for a real reason
  // (content moved back into it, or the operator's own files already there), this mkdir
  // branch is simply never reached and the existing directory is left completely untouched —
  // scanRoot() already handles an absent _Unsequenced correctly (it just doesn't appear in the
  // scan), and moveFilesToUnsequenced()/moveFilesToEnroute() each still recreate it on demand
  // via their own recursive mkdir whenever a file actually needs to land there again.
  if (other.length > 0) {
    await fsp.mkdir(unsequencedDir, { recursive: true });
  }

  for (const dirName of other) {
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

// Pure, synchronous, read-only validation — no filesystem access, no qmzRoot. Extracted
// verbatim from createSequence() (Stage 3 of "PDF-Assisted QMZ Workspace Folder Generation")
// so a caller needing to validate a (number, letter, suffix) triple WITHOUT creating anything
// — e.g. a renderer-side PDF-review correction field — uses the exact same authoritative rules
// createSequence() itself enforces, rather than a second, independently-maintained copy of
// them. createSequence() now calls this first; this is a pure refactor, not a behavior change
// — see test/qmzSuffixedCombinedTypeRegression.test.js's Group A/B, re-run unchanged after
// this extraction, for the regression coverage proving that.
function validateSequenceInput(number, letter, suffix = '') {
  letter = String(letter ?? '').toUpperCase();
  if (!LETTER_TYPE[letter]) return { ok: false, error: `Invalid letter: ${letter}` };
  suffix = String(suffix ?? '').toLowerCase();
  if (suffix && !/^[a-z]$/.test(suffix)) return { ok: false, error: `Invalid sequence suffix: ${suffix}` };
  const max = LETTER_MAX[letter] ?? MAX_SEQUENCE_NUMBER;
  if (!Number.isInteger(number) || number < 1 || number > max)
    return { ok: false, error: `Number out of range for ${letter}: ${number} (1–${max})` };
  const code = formatCode(number, letter, suffix);
  return { ok: true, code, number, letter, suffix, type: LETTER_TYPE[letter] };
}

// `suffix` is optional and backward-compatible — every existing caller omits
// it, so `letter`-only validation and the Q/M/Z ceilings in LETTER_MAX are
// completely untouched. MZ (and any future letter with no entry in
// LETTER_MAX) falls back to MAX_SEQUENCE_NUMBER — see that constant's own
// comment for why no MZ-specific ceiling is invented here.
async function createSequence(qmzRoot, number, letter, suffix = '') {
  const v = validateSequenceInput(number, letter, suffix);
  if (!v.ok) return v;
  ({ number, letter, suffix } = v);
  const code = v.code;
  const dir  = path.join(qmzRoot, code);

  // Stage 4 ("PDF-Assisted QMZ Workspace Folder Generation") needs to tell an operator
  // whether this call actually created a new folder or found one already there (Phase 9's
  // per-folder creation report: "01Q — Created" vs "01Q — Already exists") — checked BEFORE
  // the idempotent mkdir below so a pre-existing folder is never misreported as newly created.
  let existedBefore = false;
  try { existedBefore = (await fsp.stat(dir)).isDirectory(); } catch { /* absent — will be created */ }

  try { await fsp.mkdir(dir, { recursive: true }); }
  catch (err) { return { ok: false, error: err.message }; }

  const state   = await readState(qmzRoot);
  // Exact-string comparison on the full code (including suffix) — "05aMZ"
  // and "05bMZ" are different codes, so this already distinguishes different
  // suffixes of the same base number/type without any extra logic.
  const already = state.sequences.some(s => s.code === code);
  if (!already) {
    state.sequences.push({ code, number, letter, suffix, type: LETTER_TYPE[letter] });
    state.sequences.sort((a, b) => (a.code < b.code ? -1 : 1));
    const r = await saveState(qmzRoot, state);
    if (!r.ok) return { ok: false, error: r.error };
  }

  // `status` is additive — every pre-Stage-4 caller reads only `.ok`/`.code`/`.error` and is
  // unaffected; see test/qmzSuffixedCombinedTypeRegression.test.js, re-run unchanged.
  return { ok: true, code, status: existedBefore ? 'already-exists' : 'created' };
}

async function bulkCreateSequences(qmzRoot, items) {
  const created = [];
  const errors  = [];
  for (const { number, letter, suffix } of items) {
    const r = await createSequence(qmzRoot, number, letter, suffix);
    if (r.ok) created.push(r.code);
    else errors.push({ number, letter, suffix, error: r.error });
  }
  return { ok: errors.length === 0, created, errors };
}

// ── Enroute (Stage 4 of "PDF-Assisted QMZ Workspace Folder Generation") ────────
// A permanent, intentional sorting destination for photographs that do not belong to any
// numbered QMZ sequence. NOT a sequence number, NOT a Q/M/Z/MZ type, NOT a replacement for
// _Unsequenced, NOT a temporary recovery directory. See ENROUTE_DIR's own comment for the
// recognition rules and module's scanRoot()/_classifyOtherFolders() for how it is kept out of
// adoption/"other" classification.
//
// Idempotent, safe creation of the Enroute folder directly beneath qmzRoot. Mirrors
// createSequence()'s own existence-then-mkdir shape so the two destinations behave
// consistently, but has no code/number/letter to validate — "Enroute" is a fixed literal,
// never operator- or renderer-supplied, so there is no folder-name injection surface to guard
// against here; what this DOES guard against is an unsafe pre-existing filesystem object at
// that exact path (a file, a dangling symlink, or a symlink that escapes qmzRoot) silently
// being treated as a usable Enroute folder.
async function ensureEnroute(qmzRoot) {
  let rootStat;
  try { rootStat = await fsp.stat(qmzRoot); }
  catch { return { ok: false, folderName: ENROUTE_DIR, status: 'error', error: 'QMZ workspace root is not accessible.' }; }
  if (!rootStat.isDirectory()) {
    return { ok: false, folderName: ENROUTE_DIR, status: 'error', error: 'QMZ workspace root is not a directory.' };
  }

  const dir = path.join(qmzRoot, ENROUTE_DIR);
  let st;
  try { st = await fsp.lstat(dir); } catch { st = null; }

  // Security hardening (post-Stage-4): delegates the symlink/non-directory safety decision to
  // the same shared _assertSafeDirLevel() every other QMZ destination now uses, rather than a
  // second, independently-maintained copy of this exact logic.
  if (st) {
    const safety = await _assertSafeDirLevel(qmzRoot, dir);
    if (!safety.ok) return { ok: false, folderName: ENROUTE_DIR, status: 'conflict', error: safety.error };
    return { ok: true, folderName: ENROUTE_DIR, status: 'already-exists' };
  }

  try {
    await fsp.mkdir(dir);
  } catch (err) {
    // A concurrent creator (e.g. a second confirm click, or the manual button and a PDF-review
    // confirm racing) winning first is not an error — re-check what is actually there now
    // rather than reporting a failure for a folder that in fact exists correctly.
    if (err.code === 'EEXIST') {
      const safety = await _assertSafeDirLevel(qmzRoot, dir);
      if (!safety.ok) return { ok: false, folderName: ENROUTE_DIR, status: 'conflict', error: safety.error };
      return { ok: true, folderName: ENROUTE_DIR, status: 'already-exists' };
    }
    return { ok: false, folderName: ENROUTE_DIR, status: 'error', error: err.message };
  }
  log(`[qmz] ensureEnroute: created Enroute at ${dir}`);
  return { ok: true, folderName: ENROUTE_DIR, status: 'created' };
}

/**
 * Creates a batch of QMZ sequence folders from an operator-reviewed list (PDF-Assisted QMZ
 * Workspace Folder Generation, Stage 4), plus, optionally, the Enroute folder in the SAME
 * workspace in one combined, reported operation. Reuses createSequence()/ensureEnroute() —
 * the exact same engine the manual "Add Specific"/"Bulk Create"/"Create Enroute Folder"
 * controls already use — rather than a second, independent creation path.
 *
 * Every entry is revalidated here via validateSequenceInput(), regardless of what the
 * renderer already checked (never trust renderer validation alone) — a stale or tampered IPC
 * payload can never bypass the authoritative rule.
 *
 * Duplicate detection is scoped to THIS REQUEST ONLY: two entries in the same batch that
 * resolve to the identical code are both reported as 'duplicate-in-request' and NEITHER is
 * created — picking a winner between two operator-indistinguishable selections would be an
 * unannounced, silent decision, which this feature avoids everywhere else (see Stage 2/3's own
 * duplicate handling). An entry that merely matches a folder already on disk is not a
 * duplicate of anything — see 'already-exists', which createSequence() itself distinguishes.
 *
 * @param {string} qmzRoot
 * @param {Array<{number:number, letter:string, suffix?:string}>} entries
 * @param {{ includeEnroute?: boolean }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   results: Array<{ number, letter, suffix, code: string|null,
 *     status: 'created'|'already-exists'|'invalid'|'duplicate-in-request'|'error', error?: string }>,
 *   enroute: null | { folderName: string, status: string, error?: string },
 * }>}
 */
async function createReviewedSequences(qmzRoot, entries, { includeEnroute = false } = {}) {
  const prepared = (entries || []).map((e) => {
    const v = validateSequenceInput(e.number, e.letter, e.suffix);
    return { input: e, valid: v.ok, code: v.ok ? v.code : null, v };
  });

  const codeCounts = new Map();
  for (const p of prepared) {
    if (!p.valid) continue;
    codeCounts.set(p.code, (codeCounts.get(p.code) || 0) + 1);
  }

  const results = [];
  for (const p of prepared) {
    const { number, letter, suffix } = p.input;
    if (!p.valid) {
      results.push({ number, letter, suffix, code: null, status: 'invalid', error: p.v.error });
      continue;
    }
    if (codeCounts.get(p.code) > 1) {
      results.push({ number, letter, suffix, code: p.code, status: 'duplicate-in-request' });
      continue;
    }
    const r = await createSequence(qmzRoot, p.v.number, p.v.letter, p.v.suffix);
    if (r.ok) {
      results.push({ number: p.v.number, letter: p.v.letter, suffix: p.v.suffix, code: r.code, status: r.status });
    } else {
      results.push({ number: p.v.number, letter: p.v.letter, suffix: p.v.suffix, code: p.code, status: 'error', error: r.error });
    }
  }

  let enroute = null;
  if (includeEnroute) {
    enroute = await ensureEnroute(qmzRoot);
  }

  const ok = results.every(r => r.status === 'created' || r.status === 'already-exists')
    && (!enroute || enroute.status === 'created' || enroute.status === 'already-exists');

  log(`[qmz] createReviewedSequences: ${results.filter(r => r.status === 'created').length} created, `
    + `${results.filter(r => r.status === 'already-exists').length} already-existed, `
    + `${results.filter(r => r.status === 'invalid').length} invalid, `
    + `${results.filter(r => r.status === 'duplicate-in-request').length} duplicate-in-request, `
    + `${results.filter(r => r.status === 'error').length} error`
    + (enroute ? `, enroute=${enroute.status}` : ''));

  return { ok, results, enroute };
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

  // The existing sequence's suffix (if any) is carried through unchanged —
  // editSequenceType changes only the TYPE, never the number or suffix (there
  // is no caller/UI need for that yet, and silently discarding a suffix on a
  // type edit would be exactly the "silently discard suffixes" this
  // extension must not do).
  const newCode = formatCode(parsed.number, newLetter, parsed.suffix);
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
    ? { code: newCode, number: parsed.number, letter: newLetter, suffix: parsed.suffix, type: LETTER_TYPE[newLetter] }
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

// ── Shared path-safety validation (security hardening, post-Stage-4) ──────────────────────
//
// Root cause of the vulnerability this section closes: moveFilesToSequence()/
// moveFilesToUnsequenced()/moveFilesToEnroute() built their destination directory as
// `path.join(qmzRoot, <category>, photographerName)` and trusted `photographerName` as a
// single directory-name component with NO validation at the service/IPC boundary — only the
// renderer's own conventions (deriving it from an already-scanned folder name, or from an
// already-selected file's own parent path) ever constrained what that string actually was. A
// crafted `photographerName` such as "../../Outside" is accepted by path.join() exactly like
// any other string and collapses the traversal, moving files to a directory OUTSIDE qmzRoot
// (reproduced directly against isolated synthetic fixtures — never against a real archive —
// see test/qmzEnrouteSecurityRegression.test.js). The renderer never actually supplies such a
// value today, but the service must not depend on that remaining true forever: the trusted
// main-process boundary is supposed to be the service layer itself, not caller discipline.
//
// The fix below is intentionally the SAME shared mechanism for all three destinations: a
// photographer name is validated as exactly one path segment before any path is built from
// it, every directory LEVEL between qmzRoot and the destination is checked for an unsafe
// symlink before any write, and every source file is independently confirmed to already live
// inside qmzRoot (lexically, and — where it exists — after resolving symlinks) before it is
// ever handed to safeMoveFile(). None of this changes safeMoveFile()'s own collision policy,
// moveWithSidecar()'s sidecar co-move, or any result-reporting shape callers already depend
// on (validated-and-rejected files are reported via the exact same {src, error} shape the
// existing 'source-missing' case already used).

const UNSAFE_PATH_CHARS_RE = /[\\/\0]/; // backslash, forward slash, NUL — unconditionally, never platform-gated
const DRIVE_LETTER_RE      = /^[a-zA-Z]:$/; // a bare "C:" with no separator still changes path resolution on Windows

/**
 * A photographer name must represent exactly one directory component, never a path.
 * Deliberately does NOT use path.basename() to "fix up" an unsafe value into a different,
 * silently-substituted photographer identity — an unsafe name is rejected outright and the
 * whole move call fails fast, exactly like an invalid sequence code already does via
 * parseCode(). Ordinary names (spaces, hyphens, underscores, parentheses, …) are untouched;
 * this is strictly a path-separator/identity check, not a character-set whitelist.
 */
function validatePhotographerName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'Photographer name cannot be empty.' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: `Invalid photographer name: ${JSON.stringify(name)}` };
  }
  if (UNSAFE_PATH_CHARS_RE.test(name)) {
    return { ok: false, error: `Photographer name cannot contain a path separator: ${JSON.stringify(name)}` };
  }
  if (DRIVE_LETTER_RE.test(name)) {
    return { ok: false, error: `Invalid photographer name: ${JSON.stringify(name)}` };
  }
  return { ok: true, name };
}

/**
 * Checks ONE existing filesystem entry for safety as a directory level a move operation is
 * about to read through or create inside: absent is fine (will be created fresh by the
 * caller's own mkdir); a real directory is fine; a symlink is fine ONLY if it resolves to a
 * real directory still inside qmzRoot; anything else (a plain file, a symlink escaping the
 * workspace, a symlink to a non-directory, a broken symlink) is rejected. Mirrors
 * ensureEnroute()'s own original Stage 4 symlink-safety logic, generalized into the one
 * shared helper every destination level now goes through — see _assertSafeDestinationPath.
 */
async function _assertSafeDirLevel(qmzRoot, dirPath) {
  let st;
  try { st = await fsp.lstat(dirPath); } catch { return { ok: true }; } // nothing here yet — safe

  if (st.isSymbolicLink()) {
    let real;
    try { real = await fsp.realpath(dirPath); }
    catch { return { ok: false, error: `Path exists as a broken symlink: ${path.basename(dirPath)}` }; }
    let rootReal;
    try { rootReal = await fsp.realpath(qmzRoot); } catch { rootReal = path.resolve(qmzRoot); }
    if (!PathUtils.isPathUnderOrEqualToRoot(real, rootReal)) {
      return { ok: false, error: `Path exists as a symlink pointing outside the authorized QMZ workspace: ${path.basename(dirPath)}` };
    }
    let targetStat;
    try { targetStat = await fsp.stat(dirPath); } catch { targetStat = null; }
    if (!targetStat || !targetStat.isDirectory()) {
      return { ok: false, error: `Path exists but does not resolve to a directory: ${path.basename(dirPath)}` };
    }
    return { ok: true };
  }
  if (!st.isDirectory()) {
    return { ok: false, error: `Path exists but is not a directory: ${path.basename(dirPath)}` };
  }
  return { ok: true };
}

/**
 * Validates an entire destination directory path (e.g. `<qmzRoot>/Enroute/Abbas Bhai`) before
 * any mkdir happens: the path must be lexically contained in qmzRoot (Windows/UNC-safe, no
 * naive string-prefix match — see PathUtils.isPathUnderRoot), and EVERY directory level
 * between qmzRoot and the destination (not just the leaf) is checked via
 * _assertSafeDirLevel — a hijacked symlink at the CATEGORY level (e.g. "01Q" itself replaced
 * by a symlink) is just as dangerous as one at the photographer leaf, and recursive mkdir
 * would otherwise walk straight through it.
 *
 * Known limitation (documented, not silently claimed away): this check and the later mkdir/
 * move are not atomic. A sufficiently well-timed concurrent filesystem change between this
 * validation and the actual write (e.g. a symlink swapped in immediately after this check
 * passes) is not fully excluded by this fix — Node's fs API offers no O_NOFOLLOW-equivalent
 * for mkdir/recursive directory creation to close that TOCTOU window completely. This mirrors
 * the same residual race already inherent to every other filesystem-safety check in this
 * codebase (see e.g. main.js's own realpath-then-act patterns) and is not a regression
 * introduced here.
 */
async function _assertSafeDestinationPath(qmzRoot, destDir) {
  const rootResolved = path.resolve(qmzRoot);
  const destResolved = path.resolve(destDir);
  if (!PathUtils.isPathUnderRoot(destResolved, rootResolved)) {
    return { ok: false, error: 'Destination path is outside the authorized QMZ workspace.' };
  }
  const relParts = path.relative(rootResolved, destResolved).split(path.sep).filter(Boolean);
  let current = rootResolved;
  for (const part of relParts) {
    current = path.join(current, part);
    const r = await _assertSafeDirLevel(qmzRoot, current);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Validates one source file before it is ever handed to safeMoveFile(): must already be
 * lexically contained inside qmzRoot, must not be the workspace root itself, must not be the
 * internal qmz-sequences.json state file, must not be a directory, and — if it (or any
 * directory in its path back up to qmzRoot) is a symlink — must resolve to something still
 * inside qmzRoot. Returns the SAME {ok, reason} shape safeMoveFile() already uses for its own
 * 'source-missing' case, so existing per-file error reporting is completely unchanged for
 * every caller that only ever saw legitimate input.
 */
async function _validateSourceFile(qmzRoot, src) {
  if (typeof src !== 'string' || !src) return { ok: false, reason: 'invalid-source-path' };

  const rootResolved = path.resolve(qmzRoot);
  const srcResolved  = path.resolve(src);

  // Checked BEFORE the general containment test below: isPathUnderRoot() requires strictly
  // `startsWith(root + '/')`, so qmzRoot resolved against ITSELF would otherwise fall through
  // as a generic "outside the workspace" rejection — correct in effect (both paths reject the
  // operation) but less specific than the brief's own named case for this exact input.
  if (srcResolved === rootResolved) {
    return { ok: false, reason: 'source-is-workspace-root' };
  }
  if (!PathUtils.isPathUnderRoot(srcResolved, rootResolved)) {
    return { ok: false, reason: 'source-outside-workspace' };
  }
  if (path.dirname(srcResolved) === rootResolved && path.basename(srcResolved) === STATE_FILE) {
    return { ok: false, reason: 'source-is-internal-state-file' };
  }

  let st;
  try { st = await fsp.lstat(srcResolved); }
  catch { return { ok: false, reason: 'source-missing' }; } // preserves safeMoveFile's own existing wording for this case

  if (st.isSymbolicLink()) {
    let real;
    try { real = await fsp.realpath(srcResolved); }
    catch { return { ok: false, reason: 'source-missing' }; } // broken symlink — same user-facing outcome as a missing file
    let rootReal;
    try { rootReal = await fsp.realpath(rootResolved); } catch { rootReal = rootResolved; }
    if (!PathUtils.isPathUnderOrEqualToRoot(real, rootReal)) {
      return { ok: false, reason: 'source-symlink-escape' };
    }
    const targetStat = await fsp.stat(srcResolved).catch(() => null);
    if (targetStat && targetStat.isDirectory()) return { ok: false, reason: 'source-is-directory' };
    return { ok: true };
  }
  if (st.isDirectory()) {
    return { ok: false, reason: 'source-is-directory' };
  }
  // A regular (non-symlink) file still needs its own parent chain checked for an intermediate
  // symlink that redirects elsewhere (e.g. _Unsequenced/Abbas Bhai itself being a symlink
  // pointing outside qmzRoot) — reuses the exact same directory-level walk destinations use.
  const parentCheck = await _assertSafeDestinationPath(qmzRoot, path.dirname(srcResolved));
  if (!parentCheck.ok) return { ok: false, reason: 'source-symlink-escape' };

  return { ok: true };
}

// ── Move files ────────────────────────────────────────────────────────────────

// Workspace maintenance — shared by all three move functions below so "an empty source
// photographer folder is removed, and an empty _Unsequenced root disappears with it" has
// exactly ONE implementation, never three independently-drifting copies. Reuses
// removeIfEmptyIgnoringJunk() unchanged (never recursive, never touches anything containing a
// real file, subdirectory, XMP sidecar, hidden file other than macOS junk, or symlink — see
// that function's own guarantees) for both the leaf photographer folder AND the _Unsequenced
// root itself. Checking _Unsequenced unconditionally (not only when the move's source was
// literally inside it) is intentional and harmless: if it is already empty for an unrelated
// reason, removing it is still correct per the same "never leave an empty _Unsequenced
// lingering" rule; if it still has real content, removeIfEmptyIgnoringJunk's own check leaves
// it completely untouched.
async function _cleanupEmptySourceDirsAndUnsequencedRoot(qmzRoot, moved) {
  const sourceDirs = new Set(moved.map(m => path.dirname(m.src)));
  for (const dir of sourceDirs) {
    await removeIfEmptyIgnoringJunk(dir);
  }
  await removeIfEmptyIgnoringJunk(path.join(qmzRoot, UNSEQUENCED));
}

async function moveFilesToSequence(qmzRoot, filePaths, sequenceCode, photographerName) {
  if (!parseCode(sequenceCode)) return { ok: false, error: `Invalid sequence code: ${sequenceCode}` };
  const pgCheck = validatePhotographerName(photographerName);
  if (!pgCheck.ok) return pgCheck;
  const destDir = path.join(qmzRoot, sequenceCode, photographerName);
  const destCheck = await _assertSafeDestinationPath(qmzRoot, destDir);
  if (!destCheck.ok) return destCheck;
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const v = await _validateSourceFile(qmzRoot, src);
    if (!v.ok) { errors.push({ src, error: v.reason }); continue; }
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  // Workspace maintenance — cleans up an emptied source photographer folder (e.g.
  // _Unsequenced/Abbas Bhai, or an Enroute/Enroute-to-sequence move) and, if that leaves
  // _Unsequenced itself empty, removes it too. Previously MISSING from this function
  // entirely — _Unsequenced -> numbered-sequence assignment is one of this app's two most
  // common sorting actions, so its absence here was the main reason a fully-sorted workspace
  // never actually lost its empty _Unsequenced folder.
  await _cleanupEmptySourceDirsAndUnsequencedRoot(qmzRoot, moved);

  log(`[qmz] moveToSequence ${sequenceCode}/${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

async function moveFilesToUnsequenced(qmzRoot, filePaths, photographerName) {
  const pgCheck = validatePhotographerName(photographerName);
  if (!pgCheck.ok) return pgCheck;
  const destDir = path.join(qmzRoot, UNSEQUENCED, photographerName);
  const destCheck = await _assertSafeDestinationPath(qmzRoot, destDir);
  if (!destCheck.ok) return destCheck;
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const v = await _validateSourceFile(qmzRoot, src);
    if (!v.ok) { errors.push({ src, error: v.reason }); continue; }
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  // Clean up any sequence/Enroute photographer folder left empty by this move (real files or
  // unmoved leftovers block removal — see removeIfEmptyIgnoringJunk). This move's own
  // DESTINATION is _Unsequenced itself, so there is nothing to remove there — only the
  // (now possibly empty) SOURCE folder this move just emptied out.
  const sourceDirs = new Set(moved.map(m => path.dirname(m.src)));
  for (const dir of sourceDirs) {
    await removeIfEmptyIgnoringJunk(dir);
  }

  log(`[qmz] moveToUnsequenced ${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

// Stage 4 — moves files into Enroute exactly the way moveFilesToUnsequenced() moves files into
// _Unsequenced: same shared engine (moveWithSidecar/safeMoveFile/removeIfEmptyIgnoringJunk), no
// second file-movement implementation, no numbered-sequence validation (Enroute is not a
// sequence code and must never be forced through parseCode()/SEQ_RE to be usable as a move
// destination). Like moveFilesToUnsequenced, this never auto-queues Q/M/Z/MZ type metadata —
// Enroute is not a QMZ type, so there is no type tag to write (see the renderer's own comment
// on why _qmzAutoQueueMetadata is never called for an Enroute move, mirroring Unsequenced).
async function moveFilesToEnroute(qmzRoot, filePaths, photographerName) {
  const pgCheck = validatePhotographerName(photographerName);
  if (!pgCheck.ok) return pgCheck;
  const destDir = path.join(qmzRoot, ENROUTE_DIR, photographerName);
  const destCheck = await _assertSafeDestinationPath(qmzRoot, destDir);
  if (!destCheck.ok) return destCheck;
  try { await fsp.mkdir(destDir, { recursive: true }); } catch {}

  const moved  = [];
  const errors = [];
  for (const src of filePaths) {
    const v = await _validateSourceFile(qmzRoot, src);
    if (!v.ok) { errors.push({ src, error: v.reason }); continue; }
    const r = await moveWithSidecar(src, destDir);
    if (r.ok) moved.push({ src, dest: r.dest, action: r.action });
    else errors.push({ src, error: r.reason });
  }

  // Workspace maintenance — this move's source is very often _Unsequenced/<photographer>, so
  // this also removes _Unsequenced itself once empty (see
  // _cleanupEmptySourceDirsAndUnsequencedRoot's own comment for why checking it
  // unconditionally is safe even when the source genuinely wasn't _Unsequenced this time).
  await _cleanupEmptySourceDirsAndUnsequencedRoot(qmzRoot, moved);

  log(`[qmz] moveToEnroute ${photographerName}: ${moved.length} moved, ${errors.length} errors`);
  return { ok: errors.length === 0, moved, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  formatCode,
  parseCode,
  letterToType,
  validateSequenceInput,
  readState,
  saveState,
  scanRoot,
  initRoot,
  createSequence,
  bulkCreateSequences,
  ensureEnroute,
  createReviewedSequences,
  editSequenceType,
  removeSequence,
  moveFilesToSequence,
  moveFilesToUnsequenced,
  moveFilesToEnroute,
  resolveCaptureDates,
  // Security hardening (post-Stage-4) — validatePhotographerName() is part of the real public
  // API (moveFilesToSequence/moveFilesToUnsequenced/moveFilesToEnroute now call it internally,
  // but a caller may also want to pre-check a name before attempting a move). The remaining
  // three are test-only internals exposed so the security regression suite can exercise each
  // layer directly rather than only through a full move call.
  validatePhotographerName,
  _assertSafeDestinationPath,
  _assertSafeDirLevel,
  _validateSourceFile,
  // Test-only: exposes the Dirent/stat hardening helpers so
  // test/qmzDirentMismatchRegression.test.js can exercise them directly
  // against a real fs.stat() with a faked Dirent, mirroring
  // test/bug011DirentMismatchRegression.test.js's established technique. Not
  // part of the module's real public API — no other caller should use these
  // directly; listChildDirs/listMediaFiles already apply them internally.
  _directoryHardened,
  _fileHardened,
};
