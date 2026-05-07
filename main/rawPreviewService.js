'use strict';

/**
 * rawPreviewService.js — Main-process service.
 *
 * Extracts a large-format preview from RAW camera files using:
 *   macOS   → QuickLook (qlmanage) at 1200px
 *   Windows → Shell/WIC via nativeImage.createThumbnailFromPath
 *             (uses the same IShellItemImageFactory path as File Explorer;
 *              picks up the Microsoft RAW Image Extension WIC codec automatically)
 *
 * Returns a file:// URL on success, null on failure or unsupported platform.
 * The renderer falls back to getThumb() when null is returned.
 *
 * Cache key: SHA-1(normalized-path + ":" + size + ":" + mtimeMs)
 * Cache TTL: 30 days (stale entries evicted on next access)
 */

const { app, nativeImage } = require('electron');
const path              = require('path');
const fs                = require('fs');
const fsp               = require('fs').promises;
const crypto            = require('crypto');
const os                = require('os');
const { execFile }      = require('child_process');
const { pathToFileURL } = require('url');
const { safeStat, safeExists }  = require('../services/fileUtils');
const { RAW_EXTENSIONS }        = require('../config/app.config.js');

const PREVIEW_SIZE_PX  = 1200;
const QLMANAGE_TIMEOUT = 12_000;
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_VALID_BYTES  = 5_000;

let _cacheDir = null;

function getCacheDir() {
  if (_cacheDir) return _cacheDir;
  _cacheDir = path.join(app.getPath('userData'), 'raw-preview-cache');
  fs.mkdirSync(_cacheDir, { recursive: true });
  return _cacheDir;
}

function makeCacheKey(srcPath, stat) {
  const raw = `${path.normalize(srcPath)}:${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// ── macOS: qlmanage QuickLook ────────────────────────────────────────────────
async function extractViaQlmanage(srcPath) {
  const hash   = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const tmpDir = path.join(os.tmpdir(), `autoingest-rawpv-${hash}`);

  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const safeResolve = (val) => { if (settled) return; settled = true; resolve(val); };

    let timer;
    const proc = execFile(
      'qlmanage',
      ['-t', '-s', String(PREVIEW_SIZE_PX), '-o', tmpDir, srcPath],
      async (err) => {
        clearTimeout(timer);
        if (err) { safeResolve(null); return; }

        const outFile = path.join(tmpDir, `${path.basename(srcPath)}.png`);
        try {
          await safeStat(outFile);
          safeResolve(outFile);
        } catch {
          safeResolve(null);
        }
      }
    );

    timer = setTimeout(() => {
      proc.kill('SIGKILL');
      safeResolve(null);
    }, QLMANAGE_TIMEOUT);
  });
}

// ── Windows: Shell/WIC via nativeImage.createThumbnailFromPath ──────────────
// createThumbnailFromPath routes through the Windows Shell IShellItemImageFactory,
// which is fully WIC-based — the same code path Windows File Explorer uses.
// WIC codecs registered by the Microsoft RAW Image Extension (or OEM camera
// drivers) are picked up automatically.
//
// IMPORTANT: nativeImage.createFromPath uses Chromium's own image decoder,
// which does NOT route through WIC.  Installed RAW codecs have no effect on
// createFromPath.  createThumbnailFromPath is the correct API here.
//
// Returns a temp file path on success, null on failure or empty result.
// The caller (getRawPreview) handles stat-check, minimum-size guard, and
// copy to the persistent cache location.
async function extractViaWin32(srcPath) {
  const t0 = Date.now();
  try {
    const img     = await nativeImage.createThumbnailFromPath(
      srcPath,
      { width: PREVIEW_SIZE_PX, height: PREVIEW_SIZE_PX }
    );
    const elapsed = Date.now() - t0;

    if (!img || img.isEmpty()) {
      console.error(`[rawPreview][win] empty — codec absent or file unreadable | ${elapsed}ms | ${path.extname(srcPath)} | ${srcPath}`);
      return null;
    }

    const pngBuf = img.toPNG();
    if (!pngBuf || pngBuf.length < MIN_VALID_BYTES) {
      console.error(`[rawPreview][win] output too small (${pngBuf?.length ?? 0}B) | ${elapsed}ms | ${srcPath}`);
      return null;
    }

    const hash    = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
    const tmpDir  = path.join(os.tmpdir(), `autoingest-rawpv-${hash}`);
    const outFile = path.join(tmpDir, `${path.basename(srcPath)}.png`);
    await fsp.mkdir(tmpDir, { recursive: true });
    await fsp.writeFile(outFile, pngBuf);

    console.log(`[rawPreview][win] Shell/WIC extracted in ${elapsed}ms | ${path.basename(srcPath)}`);
    return outFile;
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[rawPreview][win] Shell/WIC failed | ${elapsed}ms | ${path.extname(srcPath)} | ${err.message}`);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────
async function getRawPreview(srcPath) {
  if (!srcPath || typeof srcPath !== 'string') return null;

  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32') return null;

  const normalized = path.normalize(srcPath);

  // Extension guard — authoritative list lives in config/app.config.js only
  const ext = path.extname(normalized).toLowerCase();
  if (!RAW_EXTENSIONS.includes(ext)) return null;

  let stat;
  try {
    stat = await safeStat(normalized);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const key  = makeCacheKey(normalized, stat);
  const dest = path.join(getCacheDir(), `${key}.png`);

  if (await safeExists(dest)) {
    try {
      const cs = await fsp.stat(dest);
      if (Date.now() - cs.mtimeMs <= MAX_CACHE_AGE_MS && cs.size >= MIN_VALID_BYTES) {
        console.log(`[rawPreview][cache] hit | ${path.basename(normalized)}`);
        return pathToFileURL(dest).href;
      }
      await fsp.unlink(dest).catch(() => {});
    } catch {}
  }

  console.log(`[rawPreview][cache] miss | ${path.basename(normalized)}`);
  const tmpFile = platform === 'darwin'
    ? await extractViaQlmanage(normalized)
    : await extractViaWin32(normalized);

  if (!tmpFile) return null;

  try {
    const ts = await fsp.stat(tmpFile);
    if (ts.size < MIN_VALID_BYTES) return null;
    await fsp.copyFile(tmpFile, dest);
    fsp.rm(path.dirname(tmpFile), { recursive: true, force: true }).catch(() => {});
    return pathToFileURL(dest).href;
  } catch {
    return null;
  }
}

module.exports = { getRawPreview };
