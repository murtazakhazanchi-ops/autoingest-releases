/**
 * thumbnailer.js — Main-process service.
 *
 * Generates and caches small JPEG thumbnails from full-resolution source images.
 *
 * Cache location: <userData>/thumb-cache/
 * Cache key:      SHA-1 of (srcPath + ":" + mtime_ms + ":" + size)
 * Thumbnail spec: max 160px wide, JPEG quality 50.
 * Original files are NEVER modified.
 *
 * RAW PREVIEW ORDER (CR2/CR3/NEF/ARW/DNG/RAF/…):
 *   macOS  → qlmanage QuickLook (OS camera-raw plugin, no descriptor risk)
 *   Windows → nativeImage (requires Microsoft RAW Image Extension)
 *   Linux / fallback → RAW_PLACEHOLDER_DATA_URL
 *   exifr and sharp are NEVER used for RAW files.
 *
 * NON-RAW PREVIEW ORDER (JPEG/PNG/TIFF/…):
 *   1. exifr embedded thumbnail
 *   2. sharp resize/JPEG fallback
 *   3. Electron nativeImage final fallback
 *
 * CONCURRENCY QUEUE:
 *   At most CONCURRENCY_LIMIT thumbnail jobs run simultaneously.
 *   Excess requests queue and drain as slots free up.
 *
 * SMALL-FILE BYPASS:
 *   Files under SMALL_FILE_BYTES skip generation and return a direct
 *   file:// URL to the original.
 */

'use strict';

const { app, nativeImage } = require('electron');
const path              = require('path');
const fs                = require('fs');
const fsp               = require('fs').promises;
const crypto            = require('crypto');
const os                = require('os');
const { execFile }      = require('child_process');
const { pathToFileURL } = require('url');
const exifr             = require('exifr');
const { safeWrite, safeStat, safeExists } = require('./fileUtils');
const config            = require('../config/app.config');

const {
    thumbnailCache,
    inFlightCache,
    generateCacheKey
} = require('./thumbnailCache');

// Derived from config so it stays in sync with the canonical extension list.
// Used to skip exifr + sharp for RAW files — both tools open file descriptors
// that can leak on malformed or exotic RAW formats.
const RAW_EXT_SET = new Set(config.RAW_EXTENSIONS);

// ── Config ────────────────────────────────────────────────────────────────────
const THUMB_MAX_SIZE    = 160;
const THUMB_QUALITY     = 50;
const CONCURRENCY_LIMIT = 4;            // max simultaneous generation jobs
const MAX_SHARP         = 1;            // avoid CPU spikes from RAW decoding
const MAX_EXIF          = 1;            // prevent parallel exifr file descriptor leaks
const EXIF_TIMEOUT_MS   = 500;          // abort hanging exifr calls before descriptors leak
const SMALL_FILE_BYTES  = 50 * 1024;   // 50 KB — use original directly
const MAX_CACHE_AGE     = 7 * 24 * 60 * 60 * 1000;  // 7 days in ms — evict stale cache entries
const MAX_THUMBNAILS    = 50;           // outer gate: max concurrent non-cached thumbnail ops
const PLACEHOLDER_DATA_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="9" width="34" height="26" rx="3" fill="#1e1e2e" stroke="#89b4fa" stroke-width="1.5"/><circle cx="20" cy="23" r="7" fill="none" stroke="#89b4fa" stroke-width="1.5"/><circle cx="20" cy="23" r="2" fill="#89b4fa"/></svg>')}`;

// ── Cache directory ───────────────────────────────────────────────────────────
let cacheDir = null;

function getCacheDir() {
  if (cacheDir) return cacheDir;
  cacheDir = path.join(app.getPath('userData'), 'thumb-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

// ── Cache key ─────────────────────────────────────────────────────────────────
function thumbPath(srcPath, mtimeMs, size) {
  const key  = `${path.normalize(srcPath)}:${size}:${mtimeMs}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  return path.join(getCacheDir(), `${hash}.jpg`);
}

let sharpActive = 0;
const sharpQueue = [];

function withSharpLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      sharpActive++;
      fn().then(resolve, reject).finally(() => {
        sharpActive--;
        if (sharpQueue.length > 0) sharpQueue.shift()();
      });
    };

    if (sharpActive < MAX_SHARP) {
      run();
    } else {
      sharpQueue.push(run);
    }
  });
}

// ── EXIF concurrency limiter ──────────────────────────────────────────────────
// Caps simultaneous exifr calls at MAX_EXIF=1 to prevent parallel file descriptor
// accumulation. exifr can open a descriptor and hold it if it stalls; serialising
// calls ensures only one is ever in-flight at a time.
let exifActive = 0;
const exifQueue = [];

function withExifLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      exifActive++;
      if (process.env.DEBUG_EXIF) {
        console.log('[EXIF active]', exifActive);  // should never exceed 1
      }
      fn().then(resolve, reject).finally(() => {
        exifActive--;
        if (exifQueue.length > 0) exifQueue.shift()();
      });
    };
    if (exifActive < MAX_EXIF) {
      run();
    } else {
      exifQueue.push(run);
    }
  });
}

/**
 * Wraps exifr.thumbnail() with:
 *  1. MAX_EXIF=1 concurrency limit — only one exifr call open at a time
 *  2. 500 ms hard timeout — if exifr hangs, resolve null so the descriptor
 *     cannot accumulate and the fallback pipeline runs immediately.
 *
 * @param {string} srcPath
 * @returns {Promise<Buffer|null>}
 */
function exifThumbnailSafe(srcPath) {
  return withExifLimit(() =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), EXIF_TIMEOUT_MS);
      exifr.thumbnail(srcPath)
        .then(buf => { clearTimeout(timer); resolve(buf || null); })
        .catch(() => { clearTimeout(timer); resolve(null); });
    })
  );
}

// ── Global file-read concurrency limiter ──────────────────────────────────────
// A cross-cutting limit applied to every actual file read regardless of which
// tool performs it (exifr, sharp, nativeImage).  Keeps the total number of
// simultaneously open source-file descriptors at MAX_FILE_READS=2, preventing
// "Closing file descriptor on garbage collection" / DEP0137 warnings that occur
// when many descriptors accumulate faster than the GC can close them.
//
// Relationship to other limiters:
//   withConcurrencyLimit  — caps total generation jobs (outer gate, MAX=4)
//   withExifLimit         — serialises exifr calls          (MAX_EXIF=1)
//   withSharpLimit        — serialises sharp decode          (MAX_SHARP=1)
//   withFileReadLimit     — caps raw file-open ops across ALL tools (MAX=2)
//
// withFileReadLimit is the innermost gate: it wraps the individual read call
// inside whatever tool-level limiter already applies.
const MAX_FILE_READS  = 2;
let   activeFileReads = 0;
const fileReadQueue   = [];

function withFileReadLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeFileReads++;
      Promise.resolve(fn())
        .then(resolve, reject)
        .finally(() => {
          activeFileReads--;
          if (fileReadQueue.length) fileReadQueue.shift()();
        });
    };
    if (activeFileReads < MAX_FILE_READS) {
      run();
    } else {
      fileReadQueue.push(run);
    }
  });
}

// ── RAW placeholder ───────────────────────────────────────────────────────────
// Distinct from PLACEHOLDER_DATA_URL so RAW tiles are visually identifiable
// when OS preview extraction fails.
const RAW_PLACEHOLDER_DATA_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="10" width="34" height="20" rx="3" fill="#1e1e2e" stroke="#f9e2af" stroke-width="1.5"/><text x="20" y="24" font-size="7" fill="#f9e2af" text-anchor="middle" font-family="monospace" font-weight="bold">RAW</text></svg>')}`;

// ── macOS QuickLook RAW preview ───────────────────────────────────────────────
// Uses qlmanage to extract a 300 px PNG preview via the OS RAW codec.
// This reads the embedded JPEG preview that macOS camera-raw plugins expose
// without decoding the full sensor data, so it is fast and never leaks an
// explicit file descriptor back into Node.
//
// Concurrency: RAW previews are already serialised by withFileReadLimit
// (MAX_FILE_READS=2) at the call site, so we do not add a separate limiter here.
//
// Returns a file:// URL to the generated PNG, or null on any failure.
// The caller is responsible for caching and cleanup.

const QLMANAGE_TIMEOUT_MS = 5000;  // bail out if qlmanage stalls

/**
 * @param {string} srcPath  Absolute path to the RAW source file.
 * @returns {Promise<string|null>}  file:// URL of the qlmanage PNG, or null.
 */
async function getMacRawPreview(srcPath) {
  // qlmanage writes <filename>.png into the output directory.
  // We use a per-file temp subdirectory so concurrent calls never collide.
  const hash   = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const tmpDir = path.join(os.tmpdir(), `autoingest-ql-${hash}`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, QLMANAGE_TIMEOUT_MS);

    // -t  → thumbnail mode (uses QuickLook thumbnail plugin)
    // -s  → max dimension in pixels
    // -o  → output directory
    execFile(
      'qlmanage',
      ['-t', '-s', '300', '-o', tmpDir, srcPath],
      { timeout: QLMANAGE_TIMEOUT_MS },
      async (err) => {
        clearTimeout(timer);
        if (err) { resolve(null); return; }

        // qlmanage names the output file as "<original-basename>.png"
        const outFile = path.join(tmpDir, `${path.basename(srcPath)}.png`);
        try {
          await safeStat(outFile);           // throws if file was not created
          resolve(toFileUrl(outFile));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

async function generateThumbnailDataUrl(srcPath, outputPath) {
  const ext   = path.extname(srcPath).toLowerCase();
  const isRaw = RAW_EXT_SET.has(ext);

  // ── RAW platform-native path ───────────────────────────────────────────────
  // exifr and sharp are NEVER used for RAW files — both tools can open file
  // descriptors that leak on malformed or exotic RAW formats.
  if (isRaw) {
    // macOS: QuickLook via qlmanage — uses the OS camera-raw plugin to extract
    // the embedded JPEG preview without decoding the full sensor data.
    if (process.platform === 'darwin') {
      try {
        const previewUrl = await withFileReadLimit(() => getMacRawPreview(srcPath));
        if (previewUrl) return previewUrl;
      } catch {}
    }

    // Windows: nativeImage — assumes "Microsoft RAW Image Extension" is
    // installed (available free from the Microsoft Store). Falls back to the
    // RAW placeholder if the codec is absent or the file is unreadable.
    if (process.platform === 'win32') {
      try {
        const image = await withFileReadLimit(() => nativeImage.createFromPath(srcPath));
        if (!image.isEmpty()) {
          return image.resize({ width: 180 }).toDataURL();
        }
      } catch {}
    }

    // Linux or OS preview unavailable → show RAW placeholder.
    return RAW_PLACEHOLDER_DATA_URL;
  }

  // ── Non-RAW pipeline (JPEG / PNG / TIFF / video) ──────────────────────────

  // Stage 1: EXIF embedded thumbnail.
  // Already serialised by withExifLimit; withFileReadLimit is the inner gate
  // that caps the raw file-open across all three stages combined.
  try {
    let thumbBuffer = null;
    thumbBuffer = await withFileReadLimit(() => exifThumbnailSafe(srcPath));

    if (thumbBuffer) {
      await cacheThumbnailBuffer(outputPath, thumbBuffer);
      return toDataUrl(thumbBuffer);
    }
  } catch {}

  // Stage 2: sharp resize/JPEG fallback.
  // Already serialised by withSharpLimit; withFileReadLimit wraps the whole
  // sharp pipeline so the descriptor is counted from open to buffer close.
  try {
    const buffer = await withSharpLimit(async () =>
      withFileReadLimit(() => {
        const sharp = require('sharp');
        return sharp(srcPath)
          .resize({ width: THUMB_MAX_SIZE })
          .jpeg({ quality: THUMB_QUALITY })
          .toBuffer();
      })
    );

    if (await cacheThumbnailBuffer(outputPath, buffer)) return toFileUrl(outputPath);
    return toDataUrl(buffer);

  } catch (e) {
    // silent fallback
  }

  // Stage 3: nativeImage final fallback.
  // createFromPath is synchronous; Promise.resolve() inside withFileReadLimit
  // handles the sync return value correctly.
  try {
    const image = await withFileReadLimit(() => nativeImage.createFromPath(srcPath));

    if (!image.isEmpty()) {
      const resized = image.resize({ width: THUMB_MAX_SIZE });
      const buffer  = resized.toJPEG(THUMB_QUALITY);
      if (await cacheThumbnailBuffer(outputPath, buffer)) return toFileUrl(outputPath);
      return toDataUrl(buffer);
    }
  } catch {}

  return PLACEHOLDER_DATA_URL;
}

// ── Global thumbnail concurrency gate ────────────────────────────────────────
// Outer limit applied to ALL non-cached thumbnail work — fast-path file access
// and full generation alike.  Prevents burst-loading 500+ files simultaneously,
// which exhausts file descriptors and overwhelms the renderer decode pipeline.
// Memory-cache hits bypass this gate entirely (they are just Map lookups).
//
// Relationship to inner limiters:
//   runWithLimit        — outer gate, ALL non-cached ops    (MAX_THUMBNAILS = 50)
//   withConcurrencyLimit — inner gate, generation jobs only  (CONCURRENCY_LIMIT = 4)
//   withExifLimit        — serialises exifr                  (MAX_EXIF = 1)
//   withSharpLimit       — serialises sharp                  (MAX_SHARP = 1)
//   withFileReadLimit    — caps file-descriptor opens        (MAX_FILE_READS = 2)
let   activeThumbs = 0;
const thumbQueue   = [];

function runWithLimit(task) {
  return new Promise((resolve) => {
    function execute() {
      activeThumbs++;
      task()
        .then(resolve)
        .catch(() => resolve(PLACEHOLDER_DATA_URL))
        .finally(() => {
          activeThumbs--;
          processThumbQueue();
        });
    }
    if (activeThumbs < MAX_THUMBNAILS) {
      execute();
    } else {
      thumbQueue.push(execute);
    }
  });
}

function processThumbQueue() {
  if (thumbQueue.length > 0 && activeThumbs < MAX_THUMBNAILS) {
    thumbQueue.shift()();
  }
}

// ── Concurrency queue ─────────────────────────────────────────────────────────
// Limits how many thumbnail generation jobs run simultaneously.
let   activeCount = 0;
const queue       = [];

function withConcurrencyLimit(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeCount++;
      fn().then(resolve, reject).finally(() => {
        activeCount--;
        if (queue.length > 0) queue.shift()();
      });
    };
    if (activeCount < CONCURRENCY_LIMIT) {
      run();
    } else {
      queue.push(run);
    }
  });
}

// ── In-memory promise deduplication ──────────────────────────────────────────
// Map<thumbFilePath, Promise<string|null>>
const inFlight = new Map();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns a displayable URL for a thumbnail of srcPath.
 * Generates on first call; returns cached file:// path where possible.
 * Never modifies the original file.
 *
 * @param {string} srcPath  Absolute OS path of the source JPEG/PNG
 * @returns {Promise<string|null>}
 */
async function getThumbnail(srcPath) {
  srcPath = path.normalize(srcPath);

  let stat;
  try {
    stat = await safeStat(srcPath);
  } catch {
    return PLACEHOLDER_DATA_URL;
  }

  // 🔴 ADD THIS (MEMORY CACHE KEY)
  const key = generateCacheKey({
    path: srcPath,
    size: stat.size,
    lastModified: stat.mtimeMs
  });

  // Memory cache hits are instant Map lookups — never rate-limited.
  const memCached = thumbnailCache.get(key);
  if (memCached) return memCached;

  // All non-cached work goes through the outer gate (MAX_THUMBNAILS = 50).
  // This prevents burst-loading large folders from exhausting file descriptors
  // or overwhelming the renderer's image decode pipeline.
  return runWithLimit(async () => {
    // Re-check after queuing — another request may have populated the cache
    // while this one waited for a runWithLimit slot.
    const fresh = thumbnailCache.get(key);
    if (fresh) return fresh;

    // Small-file bypass — confirm source is still readable, then return a
    // direct file:// URL (guards against card ejection between stat and load).
    if (stat.size < SMALL_FILE_BYTES) {
      try {
        if (await isFileReadable(srcPath)) {
          const url = pathToFileURL(srcPath).href;
          if (isValidUrl(url)) {
            thumbnailCache.set(key, url);
            return url;
          }
        }
      } catch (err) {
        console.warn('[thumbnailer] JPG fast path failed, falling back:', srcPath, err.message);
      }
      // fall through to full thumbnail generation
    }

    const tPath = thumbPath(srcPath, stat.mtimeMs, stat.size);

    // Disk cache
    if (await safeExists(tPath)) {
      try {
        const cacheStat = await safeStat(tPath);
        if (Date.now() - cacheStat.mtimeMs > MAX_CACHE_AGE) {
          await fsp.unlink(tPath).catch(() => {});
        } else {
          const result = toFileUrl(tPath);
          if (isValidUrl(result)) {
            thumbnailCache.set(key, result);
            return result;
          }
        }
      } catch {}
    }

    // In-flight dedup (memory level)
    if (inFlightCache.has(key)) return await inFlightCache.get(key);

    // In-flight dedup (disk level)
    if (inFlight.has(tPath)) return inFlight.get(tPath);

    // Full generation — inner gate (CONCURRENCY_LIMIT = 4) limits heavy I/O
    const promise = (async () => {
      try {
        return await withConcurrencyLimit(async () => {
          try {
            const result = await generateThumbnailDataUrl(srcPath, tPath);
            const url = result || PLACEHOLDER_DATA_URL;
            thumbnailCache.set(key, url);
            return url;
          } catch (err) {
            console.error('[thumbnailer] thumbnail error for', srcPath, err.message);
            return PLACEHOLDER_DATA_URL;
          }
        });
      } finally {
        inFlightCache.delete(key);
      }
    })();

    inFlightCache.set(key, promise);
    inFlight.set(tPath, promise);

    try {
      return await promise;
    } finally {
      inFlight.delete(tPath);
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toFileUrl(absPath) {
  return pathToFileURL(path.normalize(absPath)).href;
}

// Only cache/return URLs that Electron's renderer can actually load.
// Guards against undefined/null/empty leaking into the memory cache.
function isValidUrl(url) {
  return typeof url === 'string' && (url.startsWith('file://') || url.startsWith('data:'));
}

// Checks the file is readable before we hand a file:// URL to the renderer.
// Catches the race where a memory card is ejected between stat() and img.src load.
async function isFileReadable(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toDataUrl(buffer) {
  return `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`;
}

async function cacheThumbnailBuffer(outputPath, buffer) {
  try {
    await safeWrite(outputPath, Buffer.from(buffer));
    return true;
  } catch {
    // cache write failure should not prevent displaying the thumbnail
    return false;
  }
}

/**
 * Kept for app lifecycle compatibility.
 */
function shutdownWorkers() {
  // no-op
}

/**
 * Deletes all cached thumbnails.
 * Safe to call at any time — cache rebuilds on next use.
 */
function clearCache() {
  try {
    const dir = getCacheDir();
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith('.jpg')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {
    // ignore
  }
}

 // ---- EXPORTS (FINAL) ----
module.exports = {
  getThumbnail,
  clearCache,
  shutdownWorkers
};
